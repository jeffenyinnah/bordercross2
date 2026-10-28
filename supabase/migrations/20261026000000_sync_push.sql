-- =============================================================================
-- Step 6: sync push. Phones push their outbox (offline policies, then card
-- payments) to /api/sync/push. That route handler re-runs the slip validation
-- from packages/core against the server's data and then calls these functions
-- with the service role; agents cannot call them directly, so a phone can never
-- write its own verdict.
--
-- Nothing a phone pushes is dropped: a record the server cannot accept is kept
-- in sync_rejections for the back office.
-- =============================================================================

-- Problems found while syncing an offline policy (PRICE_CHANGED, ...)
alter table public.policies add column sync_flags text[] not null default '{}';

create table public.sync_rejections (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null,
  kind text not null check (kind in ('policy', 'card_payment')),
  device_id uuid references public.devices(id),
  agent_id uuid not null references public.profiles(id),
  insurer_id uuid not null references public.insurers(id),
  reason text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution_note text,
  unique (client_uuid, kind)
);
create index sync_rejections_open_idx on public.sync_rejections (insurer_id) where resolved_at is null;
alter table public.sync_rejections enable row level security;

create policy "sync_rejections_select" on public.sync_rejections for select
  using (
    (select public.get_user_role()) = 'admin'
    or agent_id = (select auth.uid())
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id()))
  );
-- staff close a rejection with a note; the evidence itself never changes
create policy "sync_rejections_resolve" on public.sync_rejections for update
  using ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())))
  with check ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())));

create or replace function public.guard_sync_rejection_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_trusted_write() then
    return new;
  end if;
  if (to_jsonb(new) - array['resolved_at', 'resolved_by', 'resolution_note'])
     is distinct from (to_jsonb(old) - array['resolved_at', 'resolved_by', 'resolution_note']) then
    raise exception 'Only the resolution of a sync rejection can change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger sync_rejections_guard_update before update on public.sync_rejections
  for each row execute function public.guard_sync_rejection_update();

-- ------------------------------------------------------------
-- Act as the agent inside a service-role call, so audit_log and auth.uid()
-- name the agent. The role claim stays service_role (a trusted write).
-- ------------------------------------------------------------
create or replace function public.sync_act_as(p_agent_id uuid, p_device_id uuid)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Sync functions are called by the server only' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_agent_id, 'role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.sub', p_agent_id::text, true);
  return public.require_agent_device(p_device_id);
end;
$$;
revoke execute on function public.sync_act_as(uuid, uuid) from public, anon, authenticated;

create or replace function public.reject_sync(
  p_profile public.profiles, p_device_id uuid, p_kind text, p_client_uuid uuid,
  p_reason text, p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sync_rejections (client_uuid, kind, device_id, agent_id, insurer_id, reason, payload)
  values (p_client_uuid, p_kind, p_device_id, p_profile.id, p_profile.insurer_id, p_reason, p_payload)
  on conflict (client_uuid, kind) do nothing;
  return jsonb_build_object('result', 'rejected', 'reason', p_reason);
end;
$$;
revoke execute on function public.reject_sync(public.profiles, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- An offline policy (core OfflinePolicyRecord). Idempotent by client_uuid.
-- Checks the number against the device's lease and the credit against its
-- reserve. A changed price does not reject the sale (the client already paid);
-- it is flagged on the policy.
-- Returns {result: created|existing|rejected, policy?, reason?}
-- ------------------------------------------------------------
create or replace function public.sync_offline_policy(
  p_agent_id uuid,
  p_device_id uuid,
  p_record jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles := public.sync_act_as(p_agent_id, p_device_id);
  v_uuid uuid := (p_record->>'client_uuid')::uuid;
  v_policy public.policies;
  v_number text := p_record->>'policy_number';
  v_match text[];
  v_seq integer;
  v_lease public.policy_number_leases;
  v_premium numeric := (p_record->>'premium_amount')::numeric;
  v_type text := p_record->>'policy_type';
  v_type_ids uuid[];
  v_type_count integer;
  v_priced_count integer;
  v_price numeric;
  v_flags text[] := '{}';
  v_method text := p_record->>'payment_method';
  v_credit public.offline_credit_leases;
  v_from_reserve numeric := 0;
  v_wallet public.credit_wallets;
  v_balance numeric;
  v_rate numeric;
  v_parent uuid;
  v_parent_rate numeric;
begin
  if v_uuid is null then
    raise exception 'client_uuid is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uuid::text, 0));

  select * into v_policy from public.policies where client_uuid = v_uuid;
  if found then
    if v_policy.agent_id <> v_profile.id then
      return public.reject_sync(v_profile, p_device_id, 'policy', v_uuid,
        'client_uuid already used by another agent', p_record);
    end if;
    return jsonb_build_object('result', 'existing', 'policy', to_jsonb(v_policy));
  end if;

  if (p_record->>'agent_id')::uuid is distinct from v_profile.id
     or (p_record->>'insurer_id')::uuid is distinct from v_profile.insurer_id
     or (p_record->>'device_id')::uuid is distinct from p_device_id then
    return public.reject_sync(v_profile, p_device_id, 'policy', v_uuid,
      'Agent, insurer or device does not match the sender', p_record);
  end if;
  if v_method not in ('VIRTUAL_CREDIT', 'POS_CARD_SLIP') or v_type not in ('monthly', 'annual')
     or v_premium is null or v_premium <= 0 then
    return public.reject_sync(v_profile, p_device_id, 'policy', v_uuid, 'Invalid policy record', p_record);
  end if;

  -- the number must come from a block leased to this device
  v_match := regexp_match(v_number, '^([A-Z0-9]+)-(\d{4})-(\d{6})$');
  v_seq := v_match[3]::integer;
  select * into v_lease from public.policy_number_leases
  where id = (p_record->>'number_lease_id')::uuid and device_id = p_device_id
  for update;
  if v_lease.id is null or v_match is null
     or v_lease.border_code <> v_match[1] or v_lease.year <> v_match[2]::integer
     or v_seq not between v_lease.start_seq and v_lease.end_seq then
    return public.reject_sync(v_profile, p_device_id, 'policy', v_uuid,
      'Policy number is not from a block leased to this device', p_record);
  end if;
  if exists (select 1 from public.policies where policy_number = v_number) then
    return public.reject_sync(v_profile, p_device_id, 'policy', v_uuid,
      'Policy number ' || v_number || ' is already used', p_record);
  end if;

  -- re-price with today's list; the device's price stands but a difference is flagged
  v_type_ids := array(select distinct jsonb_array_elements_text(p_record->'vehicle_type_ids'))::uuid[];
  select count(*), count(price), sum(price) into v_type_count, v_priced_count, v_price
  from (
    select case when v_type = 'annual' then vt.price_mzn_annual else vt.price_mzn end as price
    from public.vehicle_types vt
    where vt.id = any(v_type_ids)
      and (vt.insurer_id is null or vt.insurer_id = v_profile.insurer_id)
  ) priced;
  if v_type_count = 0 or v_type_count <> cardinality(v_type_ids) then
    return public.reject_sync(v_profile, p_device_id, 'policy', v_uuid,
      'Unknown vehicle type', p_record);
  end if;
  if v_priced_count <> v_type_count or v_price <> v_premium then
    v_flags := v_flags || 'PRICE_CHANGED';
  end if;
  if not exists (select 1 from public.insurers where id = v_profile.insurer_id
                 and v_method = any(payment_methods)) then
    v_flags := v_flags || 'METHOD_DISABLED';
  end if;

  insert into public.policies (policy_number, agent_id, insurer_id, client_name, client_id_number,
    client_nationality, vehicle_type_id, policy_type, currency, premium_amount,
    premium_mzn_equivalent, plate_number, vehicle_brand, vehicle_model, vehicle_year,
    engine_number, chassis_number, start_date, end_date, notes, border, document_type,
    payment_method, device_id, client_uuid, issued_offline, device_issued_at, synced_at,
    price_snapshot, verification_token, sync_flags)
  values (v_number, v_profile.id, v_profile.insurer_id, p_record->>'client_name',
    nullif(p_record->>'client_id_number', ''), nullif(p_record->>'client_nationality', ''),
    v_type_ids[1], v_type, 'MZN', v_premium, v_premium, upper(p_record->>'plate_number'),
    p_record->>'vehicle_brand', p_record->>'vehicle_model', (p_record->>'vehicle_year')::integer,
    nullif(p_record->>'engine_number', ''), nullif(p_record->>'chassis_number', ''),
    (p_record->>'start_date')::date, (p_record->>'end_date')::date, nullif(p_record->>'notes', ''),
    p_record->>'border', nullif(p_record->>'document_type', ''),
    v_method, p_device_id, v_uuid, true, (p_record->>'device_issued_at')::timestamptz, now(),
    p_record->'price_snapshot', p_record->>'verification_token', v_flags)
  returning * into v_policy;

  -- credit sales: spend the device's reserve; anything beyond it comes from the wallet
  if v_method = 'VIRTUAL_CREDIT' then
    select * into v_credit from public.offline_credit_leases
    where id = (p_record->>'credit_lease_id')::uuid and device_id = p_device_id
    for update;
    if v_credit.id is not null and v_credit.status = 'active' then
      v_from_reserve := least(v_premium, v_credit.reserved - v_credit.consumed);
      update public.offline_credit_leases
         set consumed = consumed + v_from_reserve,
             status = case when consumed + v_from_reserve >= reserved then 'settled' else status end,
             settled_at = case when consumed + v_from_reserve >= reserved then now() else settled_at end
       where id = v_credit.id;
    end if;

    select * into v_wallet from public.credit_wallets where agent_id = v_profile.id for update;
    if v_from_reserve < v_premium then
      v_flags := v_flags || 'CREDIT_OVER_RESERVE';
      update public.credit_wallets
         set balance_mzn = balance_mzn - (v_premium - v_from_reserve), updated_at = now()
       where id = v_wallet.id;
      update public.policies set sync_flags = v_flags where id = v_policy.id
      returning * into v_policy;
    end if;
    select balance_mzn into v_balance from public.credit_wallets where id = v_wallet.id;

    insert into public.credit_transactions (wallet_id, agent_id, insurer_id, type, currency,
      amount, balance_after, description, reference_id, performed_by)
    values (v_wallet.id, v_profile.id, v_profile.insurer_id, 'debit', 'MZN', v_premium, v_balance,
      'Offline policy sale: ' || upper(p_record->>'plate_number')
        || case when v_from_reserve > 0 then ' (from offline reserve)' else '' end,
      v_policy.id, v_profile.id);
  end if;

  -- commissions, as for online sales
  select commission_rate, parent_agent_id into v_rate, v_parent from public.profiles where id = v_profile.id;
  insert into public.commissions (policy_id, agent_id, insurer_id, commission_type, rate, amount, currency)
  values (v_policy.id, v_profile.id, v_profile.insurer_id, 'direct', v_rate,
    round(v_premium * v_rate / 100, 2), 'MZN');
  if v_parent is not null then
    select sub_agent_override_rate into v_parent_rate from public.profiles where id = v_parent;
    insert into public.commissions (policy_id, agent_id, insurer_id, commission_type, rate, amount, currency)
    values (v_policy.id, v_parent, v_profile.insurer_id, 'override', v_parent_rate,
      round(v_premium * v_parent_rate / 100, 2), 'MZN');
  end if;

  update public.policy_number_leases
     set last_used_seq = greatest(coalesce(last_used_seq, v_seq), v_seq),
         closed_at = case when greatest(coalesce(last_used_seq, v_seq), v_seq) = end_seq then now() end
   where id = v_lease.id;
  update public.devices set last_sync_at = now(), last_seen_at = now() where id = p_device_id;

  return jsonb_build_object('result', 'created', 'policy', to_jsonb(v_policy));
end;
$$;
revoke execute on function public.sync_offline_policy(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_offline_policy(uuid, uuid, jsonb) to service_role;

-- ------------------------------------------------------------
-- A card payment (core CardPaymentRecord) with the server's verdict.
-- p_verdict: {status, tier, checks, flags, matched_terminal_id, image_path}
-- A slip already used elsewhere (unique index) is stored as CONFLICT.
-- Returns {result: created|existing|rejected, payment?, reason?}
-- ------------------------------------------------------------
create or replace function public.sync_card_payment(
  p_agent_id uuid,
  p_device_id uuid,
  p_record jsonb,
  p_verdict jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles := public.sync_act_as(p_agent_id, p_device_id);
  v_uuid uuid := (p_record->>'client_uuid')::uuid;
  v_payment public.policy_payments;
  v_policy public.policies;
  v_status text := p_verdict->>'status';
  v_tier text := p_verdict->>'tier';
  v_flags text[] := array(select jsonb_array_elements_text(coalesce(p_verdict->'flags', '[]')));
  v_f jsonb := p_record->'fields';
  v_recibo integer;
begin
  if v_uuid is null then
    raise exception 'client_uuid is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uuid::text, 0));

  select * into v_payment from public.policy_payments where client_uuid = v_uuid;
  if found then
    return jsonb_build_object('result', 'existing', 'payment', to_jsonb(v_payment));
  end if;
  if (p_record->>'agent_id')::uuid is distinct from v_profile.id
     or (p_record->>'insurer_id')::uuid is distinct from v_profile.insurer_id then
    return public.reject_sync(v_profile, p_device_id, 'card_payment', v_uuid,
      'Agent or insurer does not match the sender', p_record);
  end if;
  if v_status not in ('PENDING_RECONCILIATION', 'NEEDS_REVIEW', 'CONFLICT', 'DECLINED')
     or v_tier not in ('AUTO_PASS', 'ISSUE_WITH_FLAG', 'HARD_DECLINE')
     or ((v_tier = 'HARD_DECLINE') <> (v_status = 'DECLINED')) then
    raise exception 'Invalid verdict % / %', v_status, v_tier using errcode = '22023';
  end if;

  if v_status <> 'DECLINED' then
    select * into v_policy from public.policies
    where client_uuid = (p_record->>'policy_client_uuid')::uuid and agent_id = v_profile.id;
    if v_policy.id is null then
      return public.reject_sync(v_profile, p_device_id, 'card_payment', v_uuid,
        'The policy this slip paid for is not on the server', p_record);
    end if;
    if v_policy.payment_method <> 'POS_CARD_SLIP'
       or v_policy.premium_amount <> (p_record->>'expected_amount')::numeric then
      v_status := 'CONFLICT';
      v_flags := v_flags || 'POLICY_MISMATCH';
    end if;
    if exists (select 1 from public.policy_payments where policy_id = v_policy.id) then
      return public.reject_sync(v_profile, p_device_id, 'card_payment', v_uuid,
        'Policy ' || v_policy.policy_number || ' already has a card payment', p_record);
    end if;
  end if;

  v_recibo := case when v_f->>'recibo_no' ~ '^\d{1,9}$' then (v_f->>'recibo_no')::integer end;

  <<insert_payment>>
  loop
    begin
      insert into public.policy_payments (client_uuid, policy_id, method, status, tier,
        expected_amount, expected_currency, bank_brand, merchant_name, merchant_address,
        recibo_no, card_type, pan_last4, aid, txn_type, amount, currency, approval_status,
        txn_at, auth_code, rrn, rc, tid, mid, batch, verification, copy_type, footer_code,
        matched_terminal_id, raw_ocr_text, field_confidence, edits, checks, flags,
        slip_profile_id, slip_profile_version, image_path, image_sha256, captured_at,
        gps_lat, gps_lng, gps_accuracy_m, device_id, agent_id, border_post_id, insurer_id,
        device_created_at, synced_at)
      values (v_uuid, v_policy.id, 'POS_CARD_SLIP', v_status, v_tier,
        (p_record->>'expected_amount')::numeric, 'MZN',
        v_f->>'bank_brand', v_f->>'merchant_name', v_f->>'merchant_address',
        v_recibo, v_f->>'card_type',
        case when v_f->>'pan_last4' ~ '^\d{4}$' then v_f->>'pan_last4' end,
        v_f->>'aid', v_f->>'txn_type',
        case when v_f->>'amount' ~ '^\d+(\.\d+)?$' then (v_f->>'amount')::numeric end,
        v_f->>'currency', v_f->>'approval_status',
        case when v_f->>'txn_at' ~ '^\d{4}-\d{2}-\d{2}T' then (v_f->>'txn_at')::timestamptz end,
        v_f->>'auth_code', v_f->>'rrn', v_f->>'rc', v_f->>'tid', v_f->>'mid', v_f->>'batch',
        v_f->>'verification', v_f->>'copy_type', v_f->>'footer_code',
        nullif(p_verdict->>'matched_terminal_id', '')::uuid,
        (select string_agg(l->>'text', E'\n') from jsonb_array_elements(p_record->'ocr_lines') l),
        coalesce(p_record->'field_confidence', '{}'), coalesce(p_record->'edits', '[]'),
        coalesce(p_verdict->'checks', '[]'), v_flags,
        nullif(p_record->>'slip_profile_id', '')::uuid, (p_record->>'slip_profile_version')::integer,
        nullif(p_verdict->>'image_path', ''), p_record->>'image_sha256',
        (p_record->>'captured_at')::timestamptz,
        (p_record->'gps'->>'lat')::numeric, (p_record->'gps'->>'lng')::numeric,
        (p_record->'gps'->>'accuracy_m')::numeric,
        p_device_id, v_profile.id, nullif(p_record->>'border_post_id', '')::uuid, v_profile.insurer_id,
        (p_record->>'device_created_at')::timestamptz, now())
      returning * into v_payment;
      exit insert_payment;
    exception when unique_violation then
      -- the same slip or photo is already on a live payment: keep this one for review
      if v_status in ('CONFLICT', 'DECLINED') then
        raise;
      end if;
      v_status := 'CONFLICT';
      v_flags := v_flags || 'DUPLICATE_SLIP';
    end;
  end loop;

  if v_payment.matched_terminal_id is not null and v_recibo is not null and v_status <> 'DECLINED' then
    update public.terminals set last_recibo = greatest(coalesce(last_recibo, v_recibo), v_recibo)
    where id = v_payment.matched_terminal_id;
  end if;
  update public.devices set last_sync_at = now(), last_seen_at = now() where id = p_device_id;

  return jsonb_build_object('result', 'created', 'payment', to_jsonb(v_payment));
end;
$$;
revoke execute on function public.sync_card_payment(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_card_payment(uuid, uuid, jsonb, jsonb) to service_role;

-- ------------------------------------------------------------
-- Slip photos: private bucket, written only by the sync route (service role).
-- Path: <insurer_id>/<agent_id>/<payment client_uuid>.jpg
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-slips', 'card-slips', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy "card_slips_select" on storage.objects for select
  using (
    bucket_id = 'card-slips' and (
      (select public.get_user_role()) = 'admin'
      or ((select public.is_insurer_staff())
          and (storage.foldername(name))[1] = (select public.my_insurer_id())::text)
      or (storage.foldername(name))[2] = (select auth.uid())::text
    )
  );
