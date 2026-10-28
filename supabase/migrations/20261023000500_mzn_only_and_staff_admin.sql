-- =============================================================================
-- 1. Meticais only. Prices, premiums, wallets, commissions and offline credit are
--    MZN. Exchange rates stay, reduced to ZAR->MZN and USD->MZN, only to show
--    drivers paying cash a reference amount. Card slips still record whatever
--    currency they print (policy_payments.currency) so a mismatch stays visible.
--    All live data was MZN when this ran; the checks below would fail otherwise.
-- 2. Insurer staff administration: insurer_admin manages their own insurer's
--    settings, agents, devices, terminals and wallets; finance and insurer_admin
--    review card payments.
-- =============================================================================

-- ------------------------------------------------------------
-- 1a. Columns and constraints
-- ------------------------------------------------------------
alter table public.vehicle_types
  drop column price_zar,
  drop column price_usd,
  drop column price_zar_annual,
  drop column price_usd_annual;

alter table public.credit_wallets
  drop column balance_zar,
  drop column balance_usd;

alter table public.policies alter column currency set default 'MZN';
alter table public.policies add constraint policies_currency_mzn check (currency = 'MZN');
alter table public.commissions alter column currency set default 'MZN';
alter table public.commissions add constraint commissions_currency_mzn check (currency = 'MZN');
alter table public.credit_transactions alter column currency set default 'MZN';
alter table public.credit_transactions add constraint credit_transactions_currency_mzn check (currency = 'MZN');
alter table public.offline_credit_leases alter column currency set default 'MZN';
alter table public.offline_credit_leases add constraint offline_credit_leases_currency_mzn check (currency = 'MZN');
alter table public.policy_payments alter column expected_currency set default 'MZN';
alter table public.policy_payments add constraint policy_payments_expected_mzn check (expected_currency = 'MZN');

delete from public.exchange_rates
  where to_currency <> 'MZN' or from_currency not in ('ZAR', 'USD');
insert into public.exchange_rates (from_currency, to_currency, rate)
  values ('ZAR', 'MZN', 3.4), ('USD', 'MZN', 63.5)
  on conflict (from_currency, to_currency) do nothing;
alter table public.exchange_rates add constraint exchange_rates_reference_only
  check (to_currency = 'MZN' and from_currency in ('ZAR', 'USD') and rate > 0);

-- Per-currency settings become plain MZN amounts (core reads either shape)
update public.insurers set settings = settings
  || jsonb_build_object('exposure_cap_value',
       coalesce((settings->'exposure_cap_value'->>'MZN')::numeric, (settings->>'exposure_cap_value')::numeric, 50000))
  || jsonb_build_object('offline_credit_allowance',
       coalesce((settings->'offline_credit_allowance'->>'MZN')::numeric, (settings->>'offline_credit_allowance')::numeric, 0));

alter table public.insurers alter column settings set default '{
    "slip_time_window_min": 10,
    "ocr_conf_auto": 0.90,
    "ocr_conf_min": 0.60,
    "expected_copy_wording": [],
    "exposure_cap_count": 5,
    "exposure_cap_value": 50000,
    "same_pan_amount_window_min": 30,
    "fuzzy_max_distance": 1,
    "image_retention_days": 730,
    "offline_grace_days": 7,
    "whitelist_stale_hours": 24,
    "number_block_size": 50,
    "offline_credit_allowance": 0,
    "settlement_lag_days": 3
  }'::jsonb;

-- ------------------------------------------------------------
-- 1b. create_policy_with_debit: MZN only. The signature is unchanged so older
--     callers keep working; p_currency must be MZN (or null).
-- ------------------------------------------------------------
create or replace function public.create_policy_with_debit(
  p_vehicle_type_ids uuid[],
  p_policy_type text,
  p_currency text,
  p_client_name text,
  p_plate text,
  p_brand text,
  p_model text,
  p_start_date date,
  p_year integer default null,
  p_engine text default null,
  p_chassis text default null,
  p_client_id text default null,
  p_nationality text default null,
  p_notes text default null,
  p_border text default null,
  p_document_type text default null,
  p_document_url text default null,
  p_agent_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_caller_active boolean;
  v_agent_id uuid;
  v_agent_active boolean;
  v_agent_insurer uuid;
  v_type_count integer;
  v_priced_count integer;
  v_premium numeric;
  v_type_names text;
  v_notes text := nullif(p_notes, '');
  v_wallet public.credit_wallets%rowtype;
  v_policy_id uuid;
  v_end_date date;
  v_agent_commission numeric;
  v_parent_id uuid;
  v_parent_rate numeric;
  v_border_code text;
  v_balance_after numeric;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select role, is_active into v_caller_role, v_caller_active
  from public.profiles where id = v_caller;
  if v_caller_role is null or not v_caller_active then
    raise exception 'Account is inactive or has no profile' using errcode = '42501';
  end if;
  if v_caller_role not in ('admin', 'agent') then
    raise exception 'Only agents can issue policies' using errcode = '42501';
  end if;

  -- Agents always issue as themselves; admins may issue on behalf of an agent
  v_agent_id := case when v_caller_role = 'admin' and p_agent_id is not null
                     then p_agent_id else v_caller end;
  if v_agent_id <> v_caller then
    select is_active into v_agent_active from public.profiles where id = v_agent_id;
    if v_agent_active is distinct from true then
      raise exception 'Agent is inactive or does not exist';
    end if;
  end if;

  select coalesce(insurer_id, public.default_insurer_id()) into v_agent_insurer
  from public.profiles where id = v_agent_id;

  if p_policy_type not in ('monthly', 'annual') then
    raise exception 'Invalid policy type';
  end if;
  if coalesce(p_currency, 'MZN') <> 'MZN' then
    raise exception 'Policies are sold in MZN only';
  end if;
  if p_vehicle_type_ids is null or cardinality(p_vehicle_type_ids) = 0 then
    raise exception 'Select at least one vehicle type';
  end if;
  if nullif(trim(p_client_name), '') is null or nullif(trim(p_plate), '') is null then
    raise exception 'Client name and plate number are required';
  end if;

  -- Price every selected (distinct, active, insurer-visible) vehicle type from the DB
  select count(*),
         count(price),
         sum(price),
         string_agg(name, ' + ' order by name)
    into v_type_count, v_priced_count, v_premium, v_type_names
  from (
    select vt.name,
      case when p_policy_type = 'annual' then vt.price_mzn_annual else vt.price_mzn end as price
    from public.vehicle_types vt
    where vt.id in (select distinct unnest(p_vehicle_type_ids))
      and vt.is_active
      and (vt.insurer_id is null or vt.insurer_id = v_agent_insurer)
  ) priced;

  if v_type_count <> (select count(distinct x) from unnest(p_vehicle_type_ids) x) then
    raise exception 'One or more vehicle types are invalid or inactive';
  end if;
  if v_priced_count <> v_type_count then
    raise exception 'No % price configured for one or more vehicle types', p_policy_type;
  end if;
  if v_premium <= 0 then
    raise exception 'Premium must be greater than zero';
  end if;

  if v_type_count > 1 then
    v_notes := concat_ws(' | ', v_notes, 'Coverage: ' || v_type_names);
  end if;

  -- Resolve border code (lookup by name or id)
  if p_border is not null and p_border <> '' then
    select code into v_border_code from public.border_posts
    where name = p_border or id::text = p_border
    limit 1;
  end if;

  -- Lock wallet. Only admins (issuing for themselves) may have no wallet.
  select * into v_wallet from public.credit_wallets where agent_id = v_agent_id for update;
  if v_wallet.id is null then
    if not (v_caller_role = 'admin' and v_agent_id = v_caller) then
      raise exception 'No credit wallet for this agent';
    end if;
  elsif v_wallet.balance_mzn < v_premium then
    raise exception 'Insufficient balance: % MZN needed, % MZN available', v_premium, v_wallet.balance_mzn;
  end if;

  v_end_date := case when p_policy_type = 'annual'
    then p_start_date + interval '365 days'
    else p_start_date + interval '30 days' end;

  insert into public.policies (policy_number, agent_id, insurer_id, client_name, client_id_number,
    client_nationality, vehicle_type_id, policy_type, currency, premium_amount,
    premium_mzn_equivalent, plate_number, vehicle_brand, vehicle_model, vehicle_year,
    engine_number, chassis_number, start_date, end_date, notes,
    border, document_type, document_url, payment_method)
  values (public.generate_policy_number(coalesce(v_border_code, 'BORD')), v_agent_id,
    v_agent_insurer, p_client_name, p_client_id, p_nationality, p_vehicle_type_ids[1],
    p_policy_type, 'MZN', v_premium, v_premium, upper(p_plate), p_brand, p_model,
    p_year, p_engine, p_chassis, p_start_date, v_end_date, v_notes,
    p_border, p_document_type, p_document_url, 'VIRTUAL_CREDIT')
  returning id into v_policy_id;

  if v_wallet.id is not null then
    update public.credit_wallets
       set balance_mzn = balance_mzn - v_premium, updated_at = now()
     where id = v_wallet.id
    returning balance_mzn into v_balance_after;

    insert into public.credit_transactions (wallet_id, agent_id, insurer_id, type, currency,
      amount, balance_after, description, reference_id, performed_by)
    values (v_wallet.id, v_agent_id, v_agent_insurer, 'debit', 'MZN', v_premium,
      v_balance_after, 'Policy sale: ' || upper(p_plate), v_policy_id, v_caller);
  end if;

  -- Agent commission
  select commission_rate, parent_agent_id into v_agent_commission, v_parent_id
  from public.profiles where id = v_agent_id;
  insert into public.commissions (policy_id, agent_id, insurer_id, commission_type, rate, amount, currency)
  values (v_policy_id, v_agent_id, v_agent_insurer, 'direct', v_agent_commission,
    round(v_premium * v_agent_commission / 100, 2), 'MZN');

  -- Override commission for parent
  if v_parent_id is not null then
    select sub_agent_override_rate into v_parent_rate from public.profiles where id = v_parent_id;
    insert into public.commissions (policy_id, agent_id, insurer_id, commission_type, rate, amount, currency)
    values (v_policy_id, v_parent_id, v_agent_insurer, 'override', v_parent_rate,
      round(v_premium * v_parent_rate / 100, 2), 'MZN');
  end if;

  return v_policy_id;
end;
$$;

-- ------------------------------------------------------------
-- 1c. Wallet top-up: MZN; platform admins for anyone, insurer admins for
--     their own insurer's agents. p_currency kept for older callers.
-- ------------------------------------------------------------
create or replace function public.top_up_wallet(
  p_agent_id uuid,
  p_currency text,
  p_amount numeric,
  p_description text default null
)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public.get_user_role();
  v_wallet_id uuid;
  v_balance_after numeric;
begin
  if v_role is distinct from 'admin' and not (
    v_role = 'insurer_admin' and exists (
      select 1 from public.profiles
      where id = p_agent_id and role = 'agent' and insurer_id = public.my_insurer_id())
  ) then
    raise exception 'Not allowed to top up this wallet' using errcode = '42501';
  end if;
  if coalesce(p_currency, 'MZN') <> 'MZN' then
    raise exception 'Wallets are in MZN only';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  update public.credit_wallets
     set balance_mzn = balance_mzn + p_amount, updated_at = now()
   where agent_id = p_agent_id
  returning id, balance_mzn into v_wallet_id, v_balance_after;

  if v_wallet_id is null then
    raise exception 'Wallet not found for this agent';
  end if;

  insert into public.credit_transactions (wallet_id, agent_id, type, currency, amount,
    balance_after, description, performed_by)
  values (v_wallet_id, p_agent_id, 'credit', 'MZN', p_amount, v_balance_after,
    coalesce(nullif(p_description, ''), 'Top-up'), auth.uid());

  return v_balance_after;
end;
$$;

-- ------------------------------------------------------------
-- 1d. Offline credit lease: MZN only. p_currency kept for older app builds.
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
  if coalesce(p_currency, 'MZN') <> 'MZN' then
    raise exception 'Offline credit is in MZN only';
  end if;

  select * into v_existing from public.offline_credit_leases
  where device_id = p_device_id and status = 'active';
  if v_existing.id is not null then
    return to_jsonb(v_existing);
  end if;

  select coalesce((i.settings->>'offline_credit_allowance')::numeric, 0)
    into v_allowance
  from public.insurers i where i.id = v_profile.insurer_id;
  v_amount := coalesce(p_amount, v_allowance);
  if v_allowance <= 0 then
    raise exception 'Offline credit is not enabled at your insurer';
  end if;
  if v_amount <= 0 or v_amount > v_allowance then
    raise exception 'Offline credit must be between 0 and % MZN', v_allowance;
  end if;

  select * into v_wallet from public.credit_wallets where agent_id = v_profile.id for update;
  if v_wallet.id is null then
    raise exception 'No credit wallet for this agent';
  end if;
  if v_wallet.balance_mzn < v_amount then
    raise exception 'Insufficient balance to reserve % MZN for offline use', v_amount;
  end if;

  insert into public.offline_credit_leases (device_id, agent_id, insurer_id, currency, reserved)
  values (p_device_id, v_profile.id, v_profile.insurer_id, 'MZN', v_amount)
  returning * into v_lease;

  update public.credit_wallets
     set balance_mzn = balance_mzn - v_amount, updated_at = now()
   where id = v_wallet.id
  returning balance_mzn into v_balance_after;

  insert into public.credit_transactions (wallet_id, agent_id, insurer_id, type, currency, amount,
    balance_after, description, reference_id, performed_by)
  values (v_wallet.id, v_profile.id, v_profile.insurer_id, 'reserve', 'MZN', v_amount,
    v_balance_after, 'Reserved for offline sales on device', v_lease.id, v_profile.id);

  return to_jsonb(v_lease);
end;
$$;

-- ------------------------------------------------------------
-- 1e. Device snapshot: single MZN wallet balance; everything else unchanged.
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
      select jsonb_build_object('balance_mzn', w.balance_mzn)
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

-- =============================================================================
-- 2. Insurer staff administration
-- =============================================================================

-- ------------------------------------------------------------
-- 2a. Profiles: insurer admins edit their own insurer's agents. They may change
--     commission, parent, active and border post, never role/email/insurer.
-- ------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_trusted_write() or public.get_user_role() = 'admin' then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.role is distinct from old.role
    or new.email is distinct from old.email
    or new.insurer_id is distinct from old.insurer_id
  then
    raise exception 'Not allowed to change protected profile fields' using errcode = '42501';
  end if;

  -- agent-management fields: insurer admins, for agents of their own insurer
  if (new.commission_rate is distinct from old.commission_rate
    or new.sub_agent_override_rate is distinct from old.sub_agent_override_rate
    or new.parent_agent_id is distinct from old.parent_agent_id
    or new.is_active is distinct from old.is_active
    or new.border_post_id is distinct from old.border_post_id)
    and not (public.get_user_role() = 'insurer_admin'
      and old.role = 'agent' and old.insurer_id = public.my_insurer_id())
  then
    raise exception 'Not allowed to change protected profile fields' using errcode = '42501';
  end if;

  -- a parent agent must belong to the same insurer
  if new.parent_agent_id is distinct from old.parent_agent_id and new.parent_agent_id is not null
    and not exists (select 1 from public.profiles
      where id = new.parent_agent_id and role = 'agent' and insurer_id = new.insurer_id) then
    raise exception 'The parent agent must be an agent of the same insurer';
  end if;

  return new;
end;
$$;

create policy "profiles_insurer_admin_update" on public.profiles for update
  using ((select public.get_user_role()) = 'insurer_admin'
    and role = 'agent' and insurer_id = (select public.my_insurer_id()))
  with check ((select public.get_user_role()) = 'insurer_admin'
    and role = 'agent' and insurer_id = (select public.my_insurer_id()));

-- ------------------------------------------------------------
-- 2b. Insurers: insurer admins edit their own payment methods and settings;
--     name, code and active stay with the platform admin.
-- ------------------------------------------------------------
create policy "insurers_insurer_admin_update" on public.insurers for update
  using ((select public.get_user_role()) = 'insurer_admin' and id = (select public.my_insurer_id()))
  with check ((select public.get_user_role()) = 'insurer_admin' and id = (select public.my_insurer_id()));

create or replace function public.guard_insurer_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_trusted_write() or public.get_user_role() = 'admin' then
    return new;
  end if;
  if new.id is distinct from old.id or new.name is distinct from old.name
    or new.code is distinct from old.code or new.is_active is distinct from old.is_active then
    raise exception 'Only a platform admin can change the insurer name, code or status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger insurers_guard_update before update on public.insurers
  for each row execute function public.guard_insurer_update();

-- ------------------------------------------------------------
-- 2c. Policies: insurer admins cancel/edit their own insurer's policies.
-- ------------------------------------------------------------
create policy "policies_insurer_admin_update" on public.policies for update
  using ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id()))
  with check ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id()));

-- What was sold and paid never changes after issue, and a cancellation is final.
create or replace function public.guard_policy_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_trusted_write() then
    return new;
  end if;
  if new.policy_number is distinct from old.policy_number
    or new.agent_id is distinct from old.agent_id
    or new.insurer_id is distinct from old.insurer_id
    or new.vehicle_type_id is distinct from old.vehicle_type_id
    or new.policy_type is distinct from old.policy_type
    or new.currency is distinct from old.currency
    or new.premium_amount is distinct from old.premium_amount
    or new.premium_mzn_equivalent is distinct from old.premium_mzn_equivalent
    or new.payment_method is distinct from old.payment_method
    or new.start_date is distinct from old.start_date
    or new.end_date is distinct from old.end_date
    or new.verification_token is distinct from old.verification_token
    or new.client_uuid is distinct from old.client_uuid
    or new.device_id is distinct from old.device_id
  then
    raise exception 'Issued policy terms cannot be changed; cancel and reissue instead'
      using errcode = '42501';
  end if;
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'A cancelled policy cannot be reactivated' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger policies_guard_update before update on public.policies
  for each row execute function public.guard_policy_update();

-- ------------------------------------------------------------
-- 2d. Number leases visible to the device's insurer staff (agent detail page)
-- ------------------------------------------------------------
create policy "number_leases_insurer_staff_select" on public.policy_number_leases for select
  using ((select public.is_insurer_staff()) and device_id in (
    select id from public.devices where insurer_id = (select public.my_insurer_id())));

-- ------------------------------------------------------------
-- 2e. Card payment review. Approve: the payment is accepted and waits for the
--     bank settlement. Reject: the payment is not accepted and its policy is
--     cancelled. Declined attempts are evidence only and cannot be reviewed.
-- ------------------------------------------------------------
create or replace function public.review_card_payment(
  p_payment_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public.get_user_role();
  v_payment public.policy_payments%rowtype;
  v_note text := nullif(trim(p_note), '');
begin
  select * into v_payment from public.policy_payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'Payment not found';
  end if;
  if v_role is distinct from 'admin' and not (
    public.is_insurer_staff() and v_payment.insurer_id = public.my_insurer_id()
  ) then
    raise exception 'Not allowed to review this payment' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject';
  end if;
  if v_payment.status not in ('NEEDS_REVIEW', 'CONFLICT') then
    raise exception 'Only payments that need review can be approved or rejected (this one is %)', v_payment.status;
  end if;
  if p_decision = 'reject' and v_note is null then
    raise exception 'Give a reason for rejecting the payment';
  end if;

  update public.policy_payments
     set status = case p_decision when 'approve' then 'PENDING_RECONCILIATION' else 'FAILED_RECONCILIATION' end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = v_note
   where id = p_payment_id
  returning * into v_payment;

  if p_decision = 'reject' and v_payment.policy_id is not null then
    update public.policies
       set status = 'cancelled',
           notes = concat_ws(' | ', nullif(notes, ''), 'Card payment rejected: ' || v_note),
           updated_at = now()
     where id = v_payment.policy_id and status <> 'cancelled';
  end if;

  return to_jsonb(v_payment);
end;
$$;
revoke execute on function public.review_card_payment(uuid, text, text) from public, anon;
grant execute on function public.review_card_payment(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 2f. issue_policy_online links the new policy to its device; that write is
--     trusted (guard_policy_update otherwise refuses client_uuid/device_id).
-- ------------------------------------------------------------
create or replace function public.issue_policy_online(
  p_device_id uuid,
  p_client_uuid uuid,
  p_details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := public.require_agent_device(p_device_id);
  v_policy public.policies;
  v_id uuid;
begin
  if p_client_uuid is null then
    raise exception 'client_uuid is required' using errcode = '22023';
  end if;

  -- serialise retries of the same sale
  perform pg_advisory_xact_lock(hashtextextended(p_client_uuid::text, 0));

  select * into v_policy from public.policies where client_uuid = p_client_uuid;
  if found then
    if v_policy.agent_id <> v_profile.id then
      raise exception 'client_uuid already used' using errcode = '23505';
    end if;
    return to_jsonb(v_policy);
  end if;

  v_id := public.create_policy_with_debit(
    p_vehicle_type_ids => array(select jsonb_array_elements_text(p_details->'vehicle_type_ids'))::uuid[],
    p_policy_type      => p_details->>'policy_type',
    p_currency         => p_details->>'currency',
    p_client_name      => p_details->>'client_name',
    p_plate            => p_details->>'plate_number',
    p_brand            => p_details->>'vehicle_brand',
    p_model            => p_details->>'vehicle_model',
    p_start_date       => (p_details->>'start_date')::date,
    p_year             => (p_details->>'vehicle_year')::integer,
    p_engine           => nullif(p_details->>'engine_number', ''),
    p_chassis          => nullif(p_details->>'chassis_number', ''),
    p_client_id        => nullif(p_details->>'client_id_number', ''),
    p_nationality      => nullif(p_details->>'client_nationality', ''),
    p_notes            => nullif(p_details->>'notes', ''),
    p_border           => nullif(p_details->>'border', ''),
    p_document_type    => nullif(p_details->>'document_type', ''),
    p_document_url     => null
  );

  perform set_config('app.trusted_write', 'on', true);
  update public.policies
     set client_uuid = p_client_uuid,
         device_id = p_device_id,
         device_issued_at = now(),
         synced_at = now()
   where id = v_id
  returning * into v_policy;

  perform set_config('app.trusted_write', 'off', true);
  update public.devices set last_sync_at = now() where id = p_device_id;

  return to_jsonb(v_policy);
end;
$$;

revoke execute on function public.issue_policy_online(uuid, uuid, jsonb) from public, anon;
grant execute on function public.issue_policy_online(uuid, uuid, jsonb) to authenticated;
