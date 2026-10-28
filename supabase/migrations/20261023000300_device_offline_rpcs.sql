-- ============================================================
-- Step 4: device registration, offline snapshot, number-block and
-- offline-credit leases, public certificate verification.
-- All device writes go through these SECURITY DEFINER functions.
-- ============================================================

-- Resolve the calling agent and check the device belongs to them.
create or replace function public.require_agent_device(p_device_id uuid)
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile.id is null or not v_profile.is_active then
    raise exception 'Account is inactive or has no profile' using errcode = '42501';
  end if;
  if v_profile.role <> 'agent' then
    raise exception 'Only agents can use the mobile app' using errcode = '42501';
  end if;
  if p_device_id is not null and not exists (
    select 1 from public.devices
    where id = p_device_id and agent_id = v_profile.id and revoked_at is null
  ) then
    raise exception 'Device is not registered to this agent or has been revoked' using errcode = '42501';
  end if;
  return v_profile;
end;
$$;
revoke execute on function public.require_agent_device(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- Register (or re-register) a device. Idempotent for an existing device id.
-- ------------------------------------------------------------
create or replace function public.register_device(
  p_platform text,
  p_model text default null,
  p_app_version text default null,
  p_public_key text default null,
  p_device_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype := public.require_agent_device(null);
  v_id uuid;
begin
  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'Invalid platform';
  end if;

  if p_device_id is not null then
    update public.devices
      set model = coalesce(p_model, model),
          app_version = coalesce(p_app_version, app_version),
          public_key = coalesce(p_public_key, public_key),
          last_seen_at = now()
    where id = p_device_id and agent_id = v_profile.id and revoked_at is null
    returning id into v_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.devices (agent_id, insurer_id, platform, model, app_version, public_key, last_seen_at)
  values (v_profile.id, v_profile.insurer_id, p_platform, p_model, p_app_version, p_public_key, now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.register_device(text, text, text, text, uuid) from public, anon;
grant execute on function public.register_device(text, text, text, text, uuid) to authenticated;

-- ------------------------------------------------------------
-- Everything a device needs to issue policies offline, in one call.
-- Dedupe keys use the exact format of core's txnKey():
--   TID|RRN|AUTH|YYYY-MM-DDTHH:MI:SS.000Z
-- ------------------------------------------------------------
create or replace function public.get_device_snapshot(
  p_device_id uuid,
  p_dedupe_days integer default 30
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype := public.require_agent_device(p_device_id);
  v_insurer uuid := v_profile.insurer_id;
  v_since timestamptz := now() - make_interval(days => least(greatest(p_dedupe_days, 1), 365));
  v_live_statuses text[] := array['PENDING_RECONCILIATION', 'RECONCILED', 'NEEDS_REVIEW'];
begin
  update public.devices set last_seen_at = now() where id = p_device_id;

  return jsonb_build_object(
    'server_time', now(),
    'device_id', p_device_id,
    'profile', (
      select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email,
        'role', p.role, 'insurer_id', p.insurer_id, 'border_post_id', p.border_post_id,
        'is_active', p.is_active, 'commission_rate', p.commission_rate)
      from public.profiles p where p.id = v_profile.id),
    'insurer', (
      select jsonb_build_object('id', i.id, 'name', i.name, 'code', i.code,
        'payment_methods', i.payment_methods, 'settings', i.settings)
      from public.insurers i where i.id = v_insurer),
    'wallet', (
      select jsonb_build_object('balance_mzn', w.balance_mzn, 'balance_zar', w.balance_zar,
        'balance_usd', w.balance_usd)
      from public.credit_wallets w where w.agent_id = v_profile.id),
    'vehicle_types', coalesce((
      select jsonb_agg(to_jsonb(vt) - 'created_at' order by vt.name)
      from public.vehicle_types vt
      where vt.is_active and (vt.insurer_id is null or vt.insurer_id = v_insurer)), '[]'),
    'exchange_rates', coalesce((
      select jsonb_agg(jsonb_build_object('from_currency', from_currency,
        'to_currency', to_currency, 'rate', rate))
      from public.exchange_rates), '[]'),
    'border_posts', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) order by name)
      from public.border_posts where is_active), '[]'),
    'terminals', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'tid', t.tid, 'mid', t.mid,
        'insurer_id', t.insurer_id, 'assigned_agent_id', t.assigned_agent_id,
        'border_post_id', t.border_post_id, 'is_active', t.is_active, 'last_recibo', t.last_recibo))
      from public.terminals t where t.insurer_id = v_insurer), '[]'),
    'merchants', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'mid', m.mid,
        'insurer_id', m.insurer_id, 'is_active', m.is_active))
      from public.merchant_accounts m where m.insurer_id = v_insurer), '[]'),
    'slip_profiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'version', s.version,
        'config', s.config))
      from public.slip_profiles s where s.is_active), '[]'),
    'dedupe', jsonb_build_object(
      'txn_keys', coalesce((
        select jsonb_agg(pp.tid || '|' || pp.rrn || '|' || pp.auth_code || '|'
          || to_char(pp.txn_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        from public.policy_payments pp
        where pp.insurer_id = v_insurer and pp.status = any(v_live_statuses)
          and pp.created_at >= v_since
          and pp.tid is not null and pp.rrn is not null and pp.auth_code is not null
          and pp.txn_at is not null), '[]'),
      'image_hashes', coalesce((
        select jsonb_agg(pp.image_sha256)
        from public.policy_payments pp
        where pp.insurer_id = v_insurer and pp.status = any(v_live_statuses)
          and pp.created_at >= v_since and pp.image_sha256 is not null), '[]'),
      'card_amounts', coalesce((
        select jsonb_agg(jsonb_build_object('pan_last4', pp.pan_last4,
          'amount', to_char(pp.amount, 'FM999999999990.00'), 'currency', pp.currency,
          'txn_at', pp.txn_at))
        from public.policy_payments pp
        where pp.insurer_id = v_insurer and pp.status = any(v_live_statuses)
          and pp.txn_at >= now() - interval '1 day'
          and pp.pan_last4 is not null and pp.amount is not null), '[]'),
      'recibos_by_tid', coalesce((
        select jsonb_object_agg(tid, recibos) from (
          select pp.tid, jsonb_agg(distinct pp.recibo_no) as recibos
          from public.policy_payments pp
          where pp.insurer_id = v_insurer and pp.created_at >= v_since
            and pp.tid is not null and pp.recibo_no is not null
            and pp.status <> 'DECLINED'
          group by pp.tid) r), '{}')
    ),
    'open_review_count', (
      select count(*) from public.policy_payments pp
      where pp.agent_id = v_profile.id and pp.status in ('NEEDS_REVIEW', 'CONFLICT')),
    'number_leases', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.leased_at)
      from public.policy_number_leases l
      where l.device_id = p_device_id and l.closed_at is null), '[]'),
    'credit_leases', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.offline_credit_leases c
      where c.device_id = p_device_id and c.status = 'active'), '[]')
  );
end;
$$;
revoke execute on function public.get_device_snapshot(uuid, integer) from public, anon;
grant execute on function public.get_device_snapshot(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- Lease a block of policy numbers for offline issuance.
-- Taken from the same counter as online issuance, so numbers never collide.
-- ------------------------------------------------------------
create or replace function public.lease_policy_numbers(
  p_device_id uuid,
  p_border_code text,
  p_count integer default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype := public.require_agent_device(p_device_id);
  v_code text := upper(coalesce(nullif(p_border_code, ''), 'BORD'));
  v_year integer := extract(year from now())::integer;
  v_count integer;
  v_end integer;
  v_lease public.policy_number_leases%rowtype;
begin
  if v_code <> 'BORD' and not exists (
    select 1 from public.border_posts where code = v_code and is_active
  ) then
    raise exception 'Unknown border post code %', v_code;
  end if;

  select coalesce(p_count, (i.settings->>'number_block_size')::integer, 50)
    into v_count
  from public.insurers i where i.id = v_profile.insurer_id;
  if v_count < 1 or v_count > 500 then
    raise exception 'Block size must be between 1 and 500';
  end if;

  -- A device holds at most two open blocks per border and year (current + spare)
  if (select count(*) from public.policy_number_leases
      where device_id = p_device_id and border_code = v_code and year = v_year
        and closed_at is null) >= 2 then
    raise exception 'This device already holds two open number blocks for %', v_code;
  end if;

  insert into public.policy_number_counters (border_code, year, last_seq)
  values (v_code, v_year, v_count)
  on conflict (border_code, year)
    do update set last_seq = public.policy_number_counters.last_seq + v_count
  returning last_seq into v_end;

  insert into public.policy_number_leases (device_id, border_code, year, start_seq, end_seq)
  values (p_device_id, v_code, v_year, v_end - v_count + 1, v_end)
  returning * into v_lease;

  return to_jsonb(v_lease);
end;
$$;
revoke execute on function public.lease_policy_numbers(uuid, text, integer) from public, anon;
grant execute on function public.lease_policy_numbers(uuid, text, integer) to authenticated;

-- ------------------------------------------------------------
-- Reserve wallet credit on a device for offline credit sales.
-- The amount leaves the wallet now (type 'reserve'); offline sales consume it and
-- are posted against the lease on sync; the remainder is released later.
-- Idempotent: an existing active lease for the device+currency is returned.
-- ------------------------------------------------------------
create or replace function public.lease_offline_credit(
  p_device_id uuid,
  p_currency text,
  p_amount numeric default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype := public.require_agent_device(p_device_id);
  v_allowance numeric;
  v_amount numeric;
  v_wallet public.credit_wallets%rowtype;
  v_existing public.offline_credit_leases%rowtype;
  v_lease public.offline_credit_leases%rowtype;
  v_balance_after numeric;
begin
  if p_currency not in ('MZN', 'ZAR', 'USD') then
    raise exception 'Invalid currency';
  end if;

  select * into v_existing from public.offline_credit_leases
  where device_id = p_device_id and currency = p_currency and status = 'active';
  if v_existing.id is not null then
    return to_jsonb(v_existing);
  end if;

  select coalesce((i.settings->'offline_credit_allowance'->>p_currency)::numeric, 0)
    into v_allowance
  from public.insurers i where i.id = v_profile.insurer_id;
  v_amount := coalesce(p_amount, v_allowance);
  if v_allowance <= 0 then
    raise exception 'Offline credit is not enabled for % at your insurer', p_currency;
  end if;
  if v_amount <= 0 or v_amount > v_allowance then
    raise exception 'Offline credit must be between 0 and % %', v_allowance, p_currency;
  end if;

  select * into v_wallet from public.credit_wallets where agent_id = v_profile.id for update;
  if v_wallet.id is null then
    raise exception 'No credit wallet for this agent';
  end if;
  if (p_currency = 'MZN' and v_wallet.balance_mzn < v_amount)
     or (p_currency = 'ZAR' and v_wallet.balance_zar < v_amount)
     or (p_currency = 'USD' and v_wallet.balance_usd < v_amount) then
    raise exception 'Insufficient % balance to reserve % for offline use', p_currency, v_amount;
  end if;

  insert into public.offline_credit_leases (device_id, agent_id, insurer_id, currency, reserved)
  values (p_device_id, v_profile.id, v_profile.insurer_id, p_currency, v_amount)
  returning * into v_lease;

  update public.credit_wallets set
    balance_mzn = balance_mzn - case when p_currency = 'MZN' then v_amount else 0 end,
    balance_zar = balance_zar - case when p_currency = 'ZAR' then v_amount else 0 end,
    balance_usd = balance_usd - case when p_currency = 'USD' then v_amount else 0 end,
    updated_at = now()
  where id = v_wallet.id
  returning case p_currency when 'MZN' then balance_mzn
                            when 'ZAR' then balance_zar
                            else balance_usd end
    into v_balance_after;

  insert into public.credit_transactions (wallet_id, agent_id, insurer_id, type, currency, amount,
    balance_after, description, reference_id, performed_by)
  values (v_wallet.id, v_profile.id, v_profile.insurer_id, 'reserve', p_currency, v_amount,
    v_balance_after, 'Reserved for offline sales on device', v_lease.id, v_profile.id);

  return to_jsonb(v_lease);
end;
$$;
revoke execute on function public.lease_offline_credit(uuid, text, numeric) from public, anon;
grant execute on function public.lease_offline_credit(uuid, text, numeric) to authenticated;

-- ------------------------------------------------------------
-- Public certificate check behind the QR code. Returns no personal data.
-- ------------------------------------------------------------
create or replace function public.verify_policy(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;
  select jsonb_build_object(
    'policy_number', p.policy_number,
    'status', p.status,
    'valid', p.status = 'active' and current_date between p.start_date and p.end_date,
    'start_date', p.start_date,
    'end_date', p.end_date,
    'plate_number', p.plate_number,
    'vehicle', p.vehicle_brand || ' ' || p.vehicle_model,
    'insurer', i.name,
    'issued_offline', p.issued_offline,
    'synced', p.synced_at is not null or not p.issued_offline
  ) into v
  from public.policies p
  join public.insurers i on i.id = p.insurer_id
  where p.verification_token = p_token;
  return v;
end;
$$;
grant execute on function public.verify_policy(text) to anon, authenticated;
