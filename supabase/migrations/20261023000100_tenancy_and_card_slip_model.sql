-- ============================================================
-- Step 1: multi-insurer tenancy + card-slip payment data model
--   insurers, roles, devices, offline leases (numbers + credit),
--   merchant accounts, terminals, slip profiles, policy payments,
--   audit log, settlement import tables, RLS.
-- The existing virtual-credit flow keeps working: insurer_id is
-- filled from the agent's profile by trigger.
-- ============================================================

-- Generic updated_at maintenance for new tables
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True for writes that don't come from an API user: migrations / psql sessions
-- (no JWT), the service role, or SECURITY DEFINER RPCs that set app.trusted_write.
create or replace function public.is_trusted_write()
returns boolean language sql stable set search_path = '' as $$
  select auth.role() is null
      or auth.role() = 'service_role'
      or coalesce(current_setting('app.trusted_write', true), '') = 'on'
$$;

-- ------------------------------------------------------------
-- INSURERS
-- ------------------------------------------------------------
create table public.insurers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique check (code ~ '^[A-Z0-9_]{2,20}$'),
  payment_methods text[] not null default array['VIRTUAL_CREDIT']
    check (cardinality(payment_methods) > 0
       and payment_methods <@ array['VIRTUAL_CREDIT', 'POS_CARD_SLIP']),
  -- Thresholds for slip validation, offline and reconciliation.
  -- Validated by the zod schema in packages/core; keys absent here fall back to core defaults.
  settings jsonb not null default '{
    "slip_time_window_min": 10,
    "ocr_conf_auto": 0.90,
    "ocr_conf_min": 0.60,
    "expected_copy_wording": [],
    "exposure_cap_count": 5,
    "exposure_cap_value": {"MZN": 50000, "ZAR": 15000, "USD": 800},
    "same_pan_amount_window_min": 30,
    "fuzzy_max_distance": 1,
    "image_retention_days": 730,
    "offline_grace_days": 7,
    "whitelist_stale_hours": 24,
    "number_block_size": 50,
    "offline_credit_allowance": {"MZN": 0, "ZAR": 0, "USD": 0},
    "settlement_lag_days": 3
  }'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger insurers_updated_at before update on public.insurers
  for each row execute function public.set_updated_at();

-- Every existing agent and policy belongs to this insurer
insert into public.insurers (name, code) values ('Default Insurer', 'DEFAULT');

create or replace function public.default_insurer_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.insurers where code = 'DEFAULT'
$$;

-- ------------------------------------------------------------
-- PROFILES: roles, insurer, border assignment
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'insurer_admin', 'finance', 'agent'));

alter table public.profiles
  add column insurer_id uuid references public.insurers(id),
  add column border_post_id uuid references public.border_posts(id);

update public.profiles set insurer_id = public.default_insurer_id() where role <> 'admin';

-- Platform admins may have no insurer; everyone else must
alter table public.profiles add constraint profiles_insurer_required
  check (role = 'admin' or insurer_id is not null);

create index profiles_insurer_idx on public.profiles (insurer_id);
create index profiles_parent_agent_idx on public.profiles (parent_agent_id);

create or replace function public.my_insurer_id()
returns uuid language sql security definer stable set search_path = '' as $$
  select insurer_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_insurer_staff()
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(
    (select role in ('insurer_admin', 'finance') from public.profiles where id = auth.uid()),
    false)
$$;

-- Insurer and border assignment are protected like role/commission
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_trusted_write() or public.get_user_role() = 'admin' then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.role is distinct from old.role
    or new.email is distinct from old.email
    or new.commission_rate is distinct from old.commission_rate
    or new.sub_agent_override_rate is distinct from old.sub_agent_override_rate
    or new.parent_agent_id is distinct from old.parent_agent_id
    or new.is_active is distinct from old.is_active
    or new.insurer_id is distinct from old.insurer_id
    or new.border_post_id is distinct from old.border_post_id
  then
    raise exception 'Not allowed to change protected profile fields' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- VEHICLE TYPES: optional per-insurer price lists (null = all insurers)
-- ------------------------------------------------------------
alter table public.vehicle_types add column insurer_id uuid references public.insurers(id);

-- ------------------------------------------------------------
-- DEVICES (registered agent phones/tablets)
-- ------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  insurer_id uuid not null references public.insurers(id),
  platform text not null check (platform in ('ios', 'android', 'web')),
  model text,
  app_version text,
  public_key text,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  clock_offset_ms integer,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id)
);
create index devices_agent_idx on public.devices (agent_id);
create index devices_insurer_idx on public.devices (insurer_id);

-- ------------------------------------------------------------
-- POLICIES / COMMISSIONS / CREDIT TRANSACTIONS: tenancy + offline fields
-- ------------------------------------------------------------
alter table public.policies
  add column insurer_id uuid references public.insurers(id),
  add column payment_method text not null default 'VIRTUAL_CREDIT'
    check (payment_method in ('VIRTUAL_CREDIT', 'POS_CARD_SLIP')),
  add column device_id uuid references public.devices(id),
  add column client_uuid uuid unique,
  add column issued_offline boolean not null default false,
  add column device_issued_at timestamptz,
  add column synced_at timestamptz,
  add column price_snapshot jsonb,
  add column verification_token text not null unique
    default replace(gen_random_uuid()::text, '-', '');

alter table public.commissions add column insurer_id uuid references public.insurers(id);
alter table public.credit_transactions add column insurer_id uuid references public.insurers(id);

-- Offline credit leases move funds into / out of a device reserve
alter table public.credit_transactions drop constraint if exists credit_transactions_type_check;
alter table public.credit_transactions add constraint credit_transactions_type_check
  check (type in ('credit', 'debit', 'reserve', 'release'));

-- Fill insurer_id from the agent (platform admins fall back to the default insurer)
create or replace function public.set_insurer_from_agent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.insurer_id is null then
    select insurer_id into new.insurer_id from public.profiles where id = new.agent_id;
    new.insurer_id := coalesce(new.insurer_id, public.default_insurer_id());
  end if;
  return new;
end;
$$;

create trigger policies_set_insurer before insert on public.policies
  for each row execute function public.set_insurer_from_agent();
create trigger commissions_set_insurer before insert on public.commissions
  for each row execute function public.set_insurer_from_agent();
create trigger credit_transactions_set_insurer before insert on public.credit_transactions
  for each row execute function public.set_insurer_from_agent();

update public.policies p set insurer_id = coalesce(pr.insurer_id, public.default_insurer_id())
  from public.profiles pr where pr.id = p.agent_id;
update public.commissions c set insurer_id = coalesce(pr.insurer_id, public.default_insurer_id())
  from public.profiles pr where pr.id = c.agent_id;
update public.credit_transactions t set insurer_id = coalesce(pr.insurer_id, public.default_insurer_id())
  from public.profiles pr where pr.id = t.agent_id;

alter table public.policies alter column insurer_id set not null;
alter table public.commissions alter column insurer_id set not null;
alter table public.credit_transactions alter column insurer_id set not null;

create index policies_insurer_created_idx on public.policies (insurer_id, created_at desc);
create index policies_device_idx on public.policies (device_id);
create index commissions_insurer_idx on public.commissions (insurer_id, created_at desc);
create index credit_tx_insurer_idx on public.credit_transactions (insurer_id, created_at desc);

-- ------------------------------------------------------------
-- OFFLINE LEASES
-- ------------------------------------------------------------
-- Block of policy numbers taken from policy_number_counters while online,
-- consumed by the device offline. Unused numbers remain documented gaps.
create table public.policy_number_leases (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  border_code text not null,
  year integer not null,
  start_seq integer not null,
  end_seq integer not null,
  last_used_seq integer,
  leased_at timestamptz not null default now(),
  closed_at timestamptz,
  check (end_seq >= start_seq),
  check (last_used_seq is null or last_used_seq between start_seq and end_seq)
);
create index number_leases_device_idx on public.policy_number_leases (device_id) where closed_at is null;

-- Credit reserved from the agent's wallet for offline sales on one device
create table public.offline_credit_leases (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  agent_id uuid not null references public.profiles(id),
  insurer_id uuid not null references public.insurers(id),
  currency text not null check (currency in ('MZN', 'ZAR', 'USD')),
  reserved numeric(12,2) not null check (reserved > 0),
  consumed numeric(12,2) not null default 0 check (consumed >= 0),
  status text not null default 'active' check (status in ('active', 'settled', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check (consumed <= reserved)
);
create index credit_leases_device_idx on public.offline_credit_leases (device_id) where status = 'active';
create index credit_leases_agent_idx on public.offline_credit_leases (agent_id);

-- ------------------------------------------------------------
-- MERCHANT ACCOUNTS (MID) + TERMINALS (TID) whitelist
-- ------------------------------------------------------------
create table public.merchant_accounts (
  id uuid primary key default gen_random_uuid(),
  mid text not null unique check (mid ~ '^[0-9]{15}$'),
  insurer_id uuid not null references public.insurers(id),
  bank text not null,
  name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mid, insurer_id)
);
create trigger merchant_accounts_updated_at before update on public.merchant_accounts
  for each row execute function public.set_updated_at();

create table public.terminals (
  id uuid primary key default gen_random_uuid(),
  tid text not null unique check (tid ~ '^[0-9]{8}$'),
  mid text not null,
  insurer_id uuid not null references public.insurers(id),
  bank text not null,
  assigned_agent_id uuid references public.profiles(id),
  border_post_id uuid references public.border_posts(id),
  last_recibo integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a terminal's MID must belong to the same insurer
  foreign key (mid, insurer_id) references public.merchant_accounts (mid, insurer_id)
);
create trigger terminals_updated_at before update on public.terminals
  for each row execute function public.set_updated_at();
create index terminals_agent_idx on public.terminals (assigned_agent_id);
create index terminals_border_idx on public.terminals (border_post_id);
create index terminals_insurer_idx on public.terminals (insurer_id);

-- ------------------------------------------------------------
-- SLIP PROFILES (bank/network layouts as data; config schema owned by packages/core)
-- ------------------------------------------------------------
create table public.slip_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  network text not null,
  version integer not null default 1,
  match_keywords text[] not null default '{}',
  config jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, version)
);
create trigger slip_profiles_updated_at before update on public.slip_profiles
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- POLICY PAYMENTS (one per card-slip attempt; declined attempts kept, policy_id null)
-- ------------------------------------------------------------
create table public.policy_payments (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  policy_id uuid unique references public.policies(id),
  method text not null default 'POS_CARD_SLIP'
    check (method in ('VIRTUAL_CREDIT', 'POS_CARD_SLIP')),
  status text not null check (status in ('PENDING_RECONCILIATION', 'RECONCILED',
    'FAILED_RECONCILIATION', 'NEEDS_REVIEW', 'CONFLICT', 'DECLINED')),
  tier text not null check (tier in ('AUTO_PASS', 'ISSUE_WITH_FLAG', 'HARD_DECLINE')),
  check ((tier = 'HARD_DECLINE') = (status = 'DECLINED')),
  check (tier = 'HARD_DECLINE' or policy_id is not null),

  -- what the system charged (never taken from the slip)
  expected_amount numeric(12,2) not null,
  expected_currency text not null check (expected_currency in ('MZN', 'ZAR', 'USD')),

  -- parsed slip fields (final values after agent confirmation)
  bank_brand text,
  merchant_name text,
  merchant_address text,
  recibo_no integer,
  card_type text,
  pan_last4 text check (pan_last4 ~ '^[0-9]{4}$'),
  aid text,
  txn_type text,
  amount numeric(12,2),
  currency text,
  approval_status text,
  txn_at timestamptz,             -- slip date/time interpreted in Africa/Maputo
  auth_code text,
  rrn text,
  rc text,
  tid text,
  mid text,
  batch text,
  verification text,
  copy_type text,
  footer_code text,
  matched_terminal_id uuid references public.terminals(id),

  -- OCR evidence and agent edits
  raw_ocr_text text,
  field_confidence jsonb not null default '{}',
  edits jsonb not null default '[]',      -- [{field, ocr_value, edited_value, at}]
  checks jsonb not null default '[]',     -- [{id, pass, severity, expected, actual, message}]
  flags text[] not null default '{}',
  slip_profile_id uuid references public.slip_profiles(id),
  slip_profile_version integer,

  -- capture metadata
  image_path text,
  image_sha256 text check (image_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz,
  gps_lat numeric(9,6),
  gps_lng numeric(9,6),
  gps_accuracy_m numeric(8,1),

  -- who / where
  device_id uuid references public.devices(id),
  agent_id uuid not null references public.profiles(id),
  border_post_id uuid references public.border_posts(id),
  insurer_id uuid not null references public.insurers(id),

  -- lifecycle
  device_created_at timestamptz,
  synced_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger policy_payments_updated_at before update on public.policy_payments
  for each row execute function public.set_updated_at();

-- Duplicate protection. Declined attempts, sync conflicts and payments a reviewer
-- rejected are stored without competing for uniqueness, so nothing is ever dropped
-- and a confirmed duplicate is resolved by moving it to FAILED_RECONCILIATION.
create unique index policy_payments_txn_unique on public.policy_payments (tid, rrn, auth_code, txn_at)
  where status not in ('DECLINED', 'CONFLICT', 'FAILED_RECONCILIATION');
create unique index policy_payments_image_unique on public.policy_payments (image_sha256)
  where status not in ('DECLINED', 'CONFLICT', 'FAILED_RECONCILIATION');

create index policy_payments_agent_idx on public.policy_payments (agent_id, created_at desc);
create index policy_payments_insurer_status_idx on public.policy_payments (insurer_id, status);
create index policy_payments_rrn_idx on public.policy_payments (rrn);
create index policy_payments_tid_recibo_idx on public.policy_payments (tid, recibo_no);
create index policy_payments_pan_amount_idx on public.policy_payments (pan_last4, amount, txn_at);

-- Backstop: never persist a full card number in the raw OCR text.
-- PANs are 16-19 digits; MIDs (15) and RRNs (12) are left intact.
create or replace function public.mask_payment_pan()
returns trigger language plpgsql set search_path = '' as $$
declare
  m text;
begin
  if new.raw_ocr_text is not null then
    for m in select (regexp_matches(new.raw_ocr_text, '[0-9]{16,19}', 'g'))[1] loop
      new.raw_ocr_text := replace(new.raw_ocr_text, m,
        repeat('X', length(m) - 4) || right(m, 4));
    end loop;
  end if;
  return new;
end;
$$;
create trigger policy_payments_mask_pan before insert or update on public.policy_payments
  for each row execute function public.mask_payment_pan();

-- ------------------------------------------------------------
-- SETTLEMENT IMPORT (bank files; column mapping configurable per bank)
-- ------------------------------------------------------------
create table public.settlement_mappings (
  id uuid primary key default gen_random_uuid(),
  insurer_id uuid not null references public.insurers(id),
  bank text not null,
  name text not null,
  file_kind text not null check (file_kind in ('csv', 'xlsx')),
  column_map jsonb not null,      -- {"rrn": "RRN", "auth_code": "Auth", "amount": "Valor", ...}
  date_format text not null default 'DD/MM/YYYY',
  time_format text default 'HH:mm:ss',
  decimal_separator text not null default '.' check (decimal_separator in ('.', ',')),
  delimiter text default ',',
  header_row integer not null default 1,
  timezone text not null default 'Africa/Maputo',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (insurer_id, name)
);
create trigger settlement_mappings_updated_at before update on public.settlement_mappings
  for each row execute function public.set_updated_at();

create table public.settlement_imports (
  id uuid primary key default gen_random_uuid(),
  insurer_id uuid not null references public.insurers(id),
  mapping_id uuid not null references public.settlement_mappings(id),
  file_path text not null,
  file_sha256 text not null,
  uploaded_by uuid not null references public.profiles(id),
  row_count integer,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsed', 'matched', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (insurer_id, file_sha256)   -- the same file cannot be imported twice
);

create table public.settlement_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.settlement_imports(id) on delete cascade,
  insurer_id uuid not null references public.insurers(id),
  row_number integer not null,
  rrn text,
  auth_code text,
  tid text,
  mid text,
  amount numeric(12,2),
  currency text,
  txn_at timestamptz,
  raw jsonb not null,
  match_status text not null default 'UNMATCHED'
    check (match_status in ('UNMATCHED', 'MATCHED', 'AMOUNT_MISMATCH', 'ORPHAN_SETTLEMENT')),
  payment_id uuid references public.policy_payments(id),
  matched_at timestamptz
);
create index settlement_rows_rrn_idx on public.settlement_rows (rrn);
create index settlement_rows_import_idx on public.settlement_rows (import_id);
create index settlement_rows_payment_idx on public.settlement_rows (payment_id);

alter table public.policy_payments
  add column settlement_row_id uuid references public.settlement_rows(id);

-- ------------------------------------------------------------
-- AUDIT LOG (written only by triggers)
-- ------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  insurer_id uuid,
  entity text not null,
  entity_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before jsonb,
  after jsonb
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_insurer_idx on public.audit_log (insurer_id, at desc);

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_after, v_before);
begin
  -- skip no-op updates
  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;

  insert into public.audit_log (actor_id, actor_role, insurer_id, entity, entity_id, action, before, after)
  values (
    auth.uid(),
    coalesce(public.get_user_role(), auth.role()),
    case tg_table_name
      when 'insurers' then (v_row->>'id')::uuid
      when 'credit_wallets' then
        (select insurer_id from public.profiles where id = (v_row->>'agent_id')::uuid)
      else (v_row->>'insurer_id')::uuid
    end,
    tg_table_name,
    (v_row->>'id')::uuid,
    tg_op,
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_insurers after insert or update or delete on public.insurers
  for each row execute function public.audit_row();
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_row();
create trigger audit_policies after insert or update or delete on public.policies
  for each row execute function public.audit_row();
create trigger audit_credit_wallets after update on public.credit_wallets
  for each row execute function public.audit_row();
create trigger audit_devices after insert or update or delete on public.devices
  for each row execute function public.audit_row();
create trigger audit_merchant_accounts after insert or update or delete on public.merchant_accounts
  for each row execute function public.audit_row();
create trigger audit_terminals after insert or update or delete on public.terminals
  for each row execute function public.audit_row();
create trigger audit_slip_profiles after insert or update or delete on public.slip_profiles
  for each row execute function public.audit_row();
create trigger audit_policy_payments after insert or update or delete on public.policy_payments
  for each row execute function public.audit_row();
create trigger audit_settlement_mappings after insert or update or delete on public.settlement_mappings
  for each row execute function public.audit_row();

-- ------------------------------------------------------------
-- create_policy_with_debit: only agents/admins issue; vehicle types
-- must be global or belong to the agent's insurer. Body otherwise
-- unchanged from 20261023000000_security_hardening.
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
  v_mzn_rate numeric;
  v_premium_mzn numeric;
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
  if p_currency not in ('MZN', 'ZAR', 'USD') then
    raise exception 'Invalid currency';
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
      case
        when p_policy_type = 'annual' then
          case p_currency when 'MZN' then vt.price_mzn_annual
                          when 'ZAR' then vt.price_zar_annual
                          else vt.price_usd_annual end
        else
          case p_currency when 'MZN' then vt.price_mzn
                          when 'ZAR' then vt.price_zar
                          else vt.price_usd end
      end as price
    from public.vehicle_types vt
    where vt.id in (select distinct unnest(p_vehicle_type_ids))
      and vt.is_active
      and (vt.insurer_id is null or vt.insurer_id = v_agent_insurer)
  ) priced;

  if v_type_count <> (select count(distinct x) from unnest(p_vehicle_type_ids) x) then
    raise exception 'One or more vehicle types are invalid or inactive';
  end if;
  if v_priced_count <> v_type_count then
    raise exception 'No % % price configured for one or more vehicle types', p_policy_type, p_currency;
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
  elsif (p_currency = 'MZN' and v_wallet.balance_mzn < v_premium)
     or (p_currency = 'ZAR' and v_wallet.balance_zar < v_premium)
     or (p_currency = 'USD' and v_wallet.balance_usd < v_premium) then
    raise exception 'Insufficient % balance', p_currency;
  end if;

  v_end_date := case when p_policy_type = 'annual'
    then p_start_date + interval '365 days'
    else p_start_date + interval '30 days' end;

  select rate into v_mzn_rate from public.exchange_rates
  where from_currency = p_currency and to_currency = 'MZN';
  v_premium_mzn := case when p_currency = 'MZN' then v_premium
    else v_premium * coalesce(v_mzn_rate, 1) end;

  insert into public.policies (policy_number, agent_id, insurer_id, client_name, client_id_number,
    client_nationality, vehicle_type_id, policy_type, currency, premium_amount,
    premium_mzn_equivalent, plate_number, vehicle_brand, vehicle_model, vehicle_year,
    engine_number, chassis_number, start_date, end_date, notes,
    border, document_type, document_url, payment_method)
  values (public.generate_policy_number(coalesce(v_border_code, 'BORD')), v_agent_id,
    v_agent_insurer, p_client_name, p_client_id, p_nationality, p_vehicle_type_ids[1],
    p_policy_type, p_currency, v_premium, v_premium_mzn, upper(p_plate), p_brand, p_model,
    p_year, p_engine, p_chassis, p_start_date, v_end_date, v_notes,
    p_border, p_document_type, p_document_url, 'VIRTUAL_CREDIT')
  returning id into v_policy_id;

  if v_wallet.id is not null then
    update public.credit_wallets set
      balance_mzn = balance_mzn - case when p_currency = 'MZN' then v_premium else 0 end,
      balance_zar = balance_zar - case when p_currency = 'ZAR' then v_premium else 0 end,
      balance_usd = balance_usd - case when p_currency = 'USD' then v_premium else 0 end,
      updated_at = now()
    where id = v_wallet.id
    returning case p_currency when 'MZN' then balance_mzn
                              when 'ZAR' then balance_zar
                              else balance_usd end
      into v_balance_after;

    insert into public.credit_transactions (wallet_id, agent_id, insurer_id, type, currency,
      amount, balance_after, description, reference_id, performed_by)
    values (v_wallet.id, v_agent_id, v_agent_insurer, 'debit', p_currency, v_premium,
      v_balance_after, 'Policy sale: ' || upper(p_plate), v_policy_id, v_caller);
  end if;

  -- Agent commission
  select commission_rate, parent_agent_id into v_agent_commission, v_parent_id
  from public.profiles where id = v_agent_id;
  insert into public.commissions (policy_id, agent_id, insurer_id, commission_type, rate, amount, currency)
  values (v_policy_id, v_agent_id, v_agent_insurer, 'direct', v_agent_commission,
    round(v_premium * v_agent_commission / 100, 2), p_currency);

  -- Override commission for parent
  if v_parent_id is not null then
    select sub_agent_override_rate into v_parent_rate from public.profiles where id = v_parent_id;
    insert into public.commissions (policy_id, agent_id, insurer_id, commission_type, rate, amount, currency)
    values (v_policy_id, v_parent_id, v_agent_insurer, 'override', v_parent_rate,
      round(v_premium * v_parent_rate / 100, 2), p_currency);
  end if;

  return v_policy_id;
end;
$$;

-- ============================================================
-- RLS
--   admin            : everything
--   insurer_admin    : read own insurer; manage terminals/MIDs/settlement
--   finance          : read own insurer; review payments; settlement
--   agent            : own rows; read own insurer's whitelist
-- Writes from devices (payments, leases, devices) go through
-- SECURITY DEFINER sync RPCs (step 4/6), so agents get no write policies.
-- ============================================================
alter table public.insurers enable row level security;
alter table public.devices enable row level security;
alter table public.policy_number_leases enable row level security;
alter table public.offline_credit_leases enable row level security;
alter table public.merchant_accounts enable row level security;
alter table public.terminals enable row level security;
alter table public.slip_profiles enable row level security;
alter table public.policy_payments enable row level security;
alter table public.settlement_mappings enable row level security;
alter table public.settlement_imports enable row level security;
alter table public.settlement_rows enable row level security;
alter table public.audit_log enable row level security;

-- Insurer staff can read their insurer's existing business data
create policy "profiles_insurer_staff_select" on public.profiles for select
  using ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id()));
create policy "policies_insurer_staff_select" on public.policies for select
  using ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id()));
create policy "commissions_insurer_staff_select" on public.commissions for select
  using ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id()));
create policy "credit_tx_insurer_staff_select" on public.credit_transactions for select
  using ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id()));
create policy "wallets_insurer_staff_select" on public.credit_wallets for select
  using ((select public.is_insurer_staff()) and agent_id in (
    select id from public.profiles where insurer_id = (select public.my_insurer_id())));

-- INSURERS
create policy "insurers_select" on public.insurers for select
  using ((select public.get_user_role()) = 'admin' or id = (select public.my_insurer_id()));
create policy "insurers_admin_all" on public.insurers for all
  using ((select public.get_user_role()) = 'admin')
  with check ((select public.get_user_role()) = 'admin');

-- DEVICES
create policy "devices_select" on public.devices for select
  using (
    (select public.get_user_role()) = 'admin'
    or agent_id = (select auth.uid())
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id()))
  );
create policy "devices_staff_update" on public.devices for update
  using ((select public.get_user_role()) = 'admin'
    or ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id())))
  with check ((select public.get_user_role()) = 'admin'
    or ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id())));

-- OFFLINE LEASES (read-only to clients)
create policy "number_leases_select" on public.policy_number_leases for select
  using (
    (select public.get_user_role()) = 'admin'
    or device_id in (select id from public.devices where agent_id = (select auth.uid()))
  );
create policy "credit_leases_select" on public.offline_credit_leases for select
  using (
    (select public.get_user_role()) = 'admin'
    or agent_id = (select auth.uid())
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id()))
  );

-- MERCHANT ACCOUNTS + TERMINALS
create policy "merchant_accounts_select" on public.merchant_accounts for select
  using ((select public.get_user_role()) = 'admin' or insurer_id = (select public.my_insurer_id()));
create policy "merchant_accounts_manage" on public.merchant_accounts for all
  using ((select public.get_user_role()) = 'admin'
    or ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id())))
  with check ((select public.get_user_role()) = 'admin'
    or ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id())));

create policy "terminals_select" on public.terminals for select
  using ((select public.get_user_role()) = 'admin' or insurer_id = (select public.my_insurer_id()));
create policy "terminals_manage" on public.terminals for all
  using ((select public.get_user_role()) = 'admin'
    or ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id())))
  with check ((select public.get_user_role()) = 'admin'
    or ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id())));

-- SLIP PROFILES: readable by any signed-in user (cached on devices), managed by platform admin
create policy "slip_profiles_select" on public.slip_profiles for select
  using ((select auth.uid()) is not null);
create policy "slip_profiles_admin_all" on public.slip_profiles for all
  using ((select public.get_user_role()) = 'admin')
  with check ((select public.get_user_role()) = 'admin');

-- POLICY PAYMENTS: agents read own; staff read insurer; finance/insurer_admin/admin review
create policy "policy_payments_select" on public.policy_payments for select
  using (
    (select public.get_user_role()) = 'admin'
    or agent_id = (select auth.uid())
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id()))
  );
create policy "policy_payments_review" on public.policy_payments for update
  using ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())))
  with check ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())));

-- Reviewers may only change review/reconciliation fields, never the evidence
create or replace function public.guard_payment_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_trusted_write() then
    return new;
  end if;
  if (to_jsonb(new) - array['status', 'reviewed_by', 'reviewed_at', 'review_note',
        'reconciled_at', 'settlement_row_id', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'reviewed_by', 'reviewed_at', 'review_note',
        'reconciled_at', 'settlement_row_id', 'updated_at'])
  then
    raise exception 'Payment evidence is immutable; only review fields can change'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and (old.status = 'DECLINED' or new.status = 'DECLINED') then
    raise exception 'Declined attempts cannot change status' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger policy_payments_guard_update before update on public.policy_payments
  for each row execute function public.guard_payment_update();

-- SETTLEMENT: finance / insurer_admin of the insurer, or admin
create policy "settlement_mappings_access" on public.settlement_mappings for all
  using ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())))
  with check ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())));
create policy "settlement_imports_access" on public.settlement_imports for all
  using ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())))
  with check ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())));
create policy "settlement_rows_access" on public.settlement_rows for all
  using ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())))
  with check ((select public.get_user_role()) = 'admin'
    or ((select public.is_insurer_staff()) and insurer_id = (select public.my_insurer_id())));

-- AUDIT LOG: read-only
create policy "audit_log_select" on public.audit_log for select
  using ((select public.get_user_role()) = 'admin'
    or ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id())));

-- Helper functions are internal
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.set_insurer_from_agent() from public, anon, authenticated;
