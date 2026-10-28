-- ============================================================
-- BORDERCROSS initial schema (crossborder project)
-- Combines PRD section 3 base schema + supabase_migration.sql patches
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- PROFILES (extends Supabase auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'agent')),
  parent_agent_id uuid references profiles(id),
  commission_rate numeric(5,2) not null default 15.00,
  sub_agent_override_rate numeric(5,2) not null default 5.00,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- VEHICLE TYPES (admin-managed pricing table)
create table vehicle_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_mzn numeric(10,2) not null,
  price_zar numeric(10,2) not null,
  price_usd numeric(10,2) not null,
  price_mzn_annual numeric(10,2),
  price_zar_annual numeric(10,2),
  price_usd_annual numeric(10,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- EXCHANGE RATES
create table exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency text not null,
  to_currency text not null,
  rate numeric(12,6) not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique(from_currency, to_currency)
);

-- CREDIT WALLETS
create table credit_wallets (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null unique references profiles(id) on delete cascade,
  balance_mzn numeric(12,2) not null default 0,
  balance_zar numeric(12,2) not null default 0,
  balance_usd numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- CREDIT TRANSACTIONS (wallet history)
create table credit_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references credit_wallets(id),
  agent_id uuid not null references profiles(id),
  type text not null check (type in ('credit', 'debit')),
  currency text not null check (currency in ('MZN', 'ZAR', 'USD')),
  amount numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  description text,
  reference_id uuid,
  performed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- POLICIES
create table policies (
  id uuid primary key default gen_random_uuid(),
  policy_number text not null unique,
  agent_id uuid not null references profiles(id),
  client_name text not null,
  client_id_number text,
  client_nationality text,
  vehicle_type_id uuid not null references vehicle_types(id),
  policy_type text not null check (policy_type in ('monthly', 'annual')),
  currency text not null check (currency in ('MZN', 'ZAR', 'USD')),
  premium_amount numeric(10,2) not null,
  premium_mzn_equivalent numeric(10,2) not null,
  plate_number text not null,
  vehicle_brand text not null,
  vehicle_model text not null,
  vehicle_year integer,
  engine_number text,
  chassis_number text,
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- COMMISSIONS
create table commissions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id),
  agent_id uuid not null references profiles(id),
  commission_type text not null check (commission_type in ('direct', 'override')),
  rate numeric(5,2) not null,
  amount numeric(10,2) not null,
  currency text not null check (currency in ('MZN', 'ZAR', 'USD')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- SEED: Default exchange rates
insert into exchange_rates (from_currency, to_currency, rate) values
  ('USD', 'MZN', 63.50),
  ('ZAR', 'MZN', 3.40),
  ('MZN', 'USD', 0.01575),
  ('MZN', 'ZAR', 0.29412),
  ('USD', 'ZAR', 18.65),
  ('ZAR', 'USD', 0.05362);

-- SEED: Default vehicle types (from pricing table)
insert into vehicle_types (name, price_mzn, price_zar, price_usd, price_mzn_annual, price_zar_annual, price_usd_annual) values
  ('Ligeiros/Private Motor', 1700, 280, 20, 6000, 1700, 100),
  ('Pesado/Heavy Commercial', 4250, 700, 50, 8500, 2500, 110),
  ('Atrelado/Trailer for Truck', 2125, 350, 25, 4500, 1200, 60),
  ('Motociclos, Reboque e Caravanas (Private)', 850, 140, 10, 3500, 1000, 60),
  ('Road Side Assist Membership', 420, 70, 7, null, null, null);

-- ============================================================
-- 3.1 Row Level Security (RLS)
-- ============================================================

alter table profiles enable row level security;
alter table policies enable row level security;
alter table credit_wallets enable row level security;
alter table credit_transactions enable row level security;
alter table commissions enable row level security;
alter table vehicle_types enable row level security;
alter table exchange_rates enable row level security;

-- Helper: get current user role
create or replace function get_user_role()
returns text language sql security definer stable as $$
  select role from profiles where id = auth.uid()
$$;

-- PROFILES: admins see all, agents see self + their sub-agents
create policy "profiles_select" on profiles for select using (
  get_user_role() = 'admin' or id = auth.uid() or parent_agent_id = auth.uid()
);
create policy "profiles_insert" on profiles for insert with check (get_user_role() = 'admin');
create policy "profiles_update" on profiles for update using (
  get_user_role() = 'admin' or id = auth.uid()
);

-- POLICIES: admins see all, agents see own + sub-agents
create policy "policies_select" on policies for select using (
  get_user_role() = 'admin' or agent_id = auth.uid() or
  agent_id in (select id from profiles where parent_agent_id = auth.uid())
);
create policy "policies_insert" on policies for insert with check (
  agent_id = auth.uid() or get_user_role() = 'admin'
);

-- CREDIT WALLETS: admins see all, agents see own
create policy "wallets_select" on credit_wallets for select using (
  get_user_role() = 'admin' or agent_id = auth.uid()
);
create policy "wallets_update" on credit_wallets for update using (get_user_role() = 'admin');

-- CREDIT TRANSACTIONS: admins see all, agents see own
create policy "credit_tx_select" on credit_transactions for select using (
  get_user_role() = 'admin' or agent_id = auth.uid()
);

-- COMMISSIONS: admins see all, agents see own
create policy "commissions_select" on commissions for select using (
  get_user_role() = 'admin' or agent_id = auth.uid()
);

-- VEHICLE TYPES + EXCHANGE RATES: everyone can read, only admin can write
create policy "vt_select" on vehicle_types for select using (true);
create policy "vt_all" on vehicle_types for all using (get_user_role() = 'admin');
create policy "er_select" on exchange_rates for select using (true);
create policy "er_all" on exchange_rates for all using (get_user_role() = 'admin');

-- ============================================================
-- BORDER POSTS (from supabase_migration.sql)
-- ============================================================

create table border_posts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,   -- 4-letter code used in policy numbers
  province text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table border_posts enable row level security;
create policy "border_posts_select" on border_posts for select using (true);
create policy "border_posts_all" on border_posts for all using (get_user_role() = 'admin');

insert into border_posts (name, code, province) values
  ('Ressano Garcia',    'RGAR', 'Maputo'),
  ('Namaacha',          'NAMA', 'Maputo'),
  ('Ponta do Ouro',     'PORO', 'Maputo'),
  ('Chicualacuala',     'CHIC', 'Gaza'),
  ('Mapai',             'MAPA', 'Gaza'),
  ('Machanga',          'MACH', 'Sofala'),
  ('Caia',              'CAIA', 'Sofala'),
  ('Marromeu',          'MARR', 'Sofala'),
  ('Nyamapanda',        'NYAM', 'Manica'),
  ('Cassacatiza',       'CASS', 'Tete'),
  ('Zumbo',             'ZUMB', 'Tete'),
  ('Changara',          'CHAN', 'Tete'),
  ('Zobue',             'ZOBU', 'Tete'),
  ('Milange',           'MILA', 'Zambézia'),
  ('Mocuba',            'MOCU', 'Zambézia'),
  ('Cuamba',            'CUAM', 'Niassa'),
  ('Mandimba',          'MAND', 'Niassa'),
  ('Negomano',          'NEGO', 'Niassa'),
  ('Mueda',             'MUED', 'Cabo Delgado'),
  ('Mocimboa da Praia', 'MOCI', 'Cabo Delgado'),
  ('Pemba',             'PEMB', 'Cabo Delgado')
on conflict (code) do nothing;

-- Add border/document columns to policies
alter table policies add column border text;
alter table policies add column document_type text;
alter table policies add column document_url text;

-- ============================================================
-- 3.2 Database Functions (border-aware versions)
-- ============================================================

-- Auto-generate policy number (e.g. RGAR-2026-000001)
create or replace function generate_policy_number(p_border_code text default 'BORD')
returns text language plpgsql as $$
declare
  seq integer;
  year_str text := to_char(now(), 'YYYY');
begin
  select count(*) + 1 into seq from policies
  where extract(year from created_at) = extract(year from now());
  return upper(p_border_code) || '-' || year_str || '-' || lpad(seq::text, 6, '0');
end;
$$;

-- Deduct credit and create policy atomically (with border + document support)
create or replace function create_policy_with_debit(
  p_agent_id uuid, p_client_name text, p_vehicle_type_id uuid,
  p_policy_type text, p_currency text, p_premium_amount numeric,
  p_plate text, p_brand text, p_model text, p_year integer,
  p_engine text, p_chassis text, p_start_date date, p_client_id text,
  p_nationality text, p_notes text,
  p_border text default null,
  p_document_type text default null,
  p_document_url text default null
)
returns uuid language plpgsql security definer as $$
declare
  v_wallet credit_wallets%rowtype;
  v_policy_id uuid;
  v_end_date date;
  v_mzn_rate numeric;
  v_premium_mzn numeric;
  v_agent_commission numeric;
  v_parent_id uuid;
  v_parent_rate numeric;
  v_border_code text;
begin
  -- Resolve border code (lookup by name or id)
  if p_border is not null and p_border <> '' then
    select code into v_border_code from border_posts
    where name = p_border or id::text = p_border
    limit 1;
  end if;
  if v_border_code is null then v_border_code := 'BORD'; end if;

  -- Check wallet balance
  select * into v_wallet from credit_wallets where agent_id = p_agent_id for update;
  if v_wallet is null then
    -- Admin has no wallet — skip balance check
    v_wallet.id := null;
    v_wallet.balance_mzn := 0;
    v_wallet.balance_zar := 0;
    v_wallet.balance_usd := 0;
  else
    if p_currency = 'MZN' and v_wallet.balance_mzn < p_premium_amount then
      raise exception 'Insufficient MZN balance';
    elsif p_currency = 'ZAR' and v_wallet.balance_zar < p_premium_amount then
      raise exception 'Insufficient ZAR balance';
    elsif p_currency = 'USD' and v_wallet.balance_usd < p_premium_amount then
      raise exception 'Insufficient USD balance';
    end if;
  end if;

  -- Calculate end date
  v_end_date := case when p_policy_type = 'annual'
    then p_start_date + interval '365 days'
    else p_start_date + interval '30 days' end;

  -- Convert premium to MZN
  select rate into v_mzn_rate from exchange_rates
  where from_currency = p_currency and to_currency = 'MZN';
  v_premium_mzn := case when p_currency = 'MZN' then p_premium_amount
    else p_premium_amount * coalesce(v_mzn_rate, 1) end;

  -- Create policy
  insert into policies (policy_number, agent_id, client_name, client_id_number,
    client_nationality, vehicle_type_id, policy_type, currency, premium_amount,
    premium_mzn_equivalent, plate_number, vehicle_brand, vehicle_model, vehicle_year,
    engine_number, chassis_number, start_date, end_date, notes,
    border, document_type, document_url)
  values (generate_policy_number(v_border_code), p_agent_id, p_client_name, p_client_id,
    p_nationality, p_vehicle_type_id, p_policy_type, p_currency, p_premium_amount,
    v_premium_mzn, p_plate, p_brand, p_model, p_year, p_engine, p_chassis,
    p_start_date, v_end_date, p_notes,
    p_border, p_document_type, p_document_url)
  returning id into v_policy_id;

  -- Deduct from wallet (skip if admin with no wallet)
  if v_wallet.id is not null then
    if p_currency = 'MZN' then
      update credit_wallets set balance_mzn = balance_mzn - p_premium_amount,
        updated_at = now() where agent_id = p_agent_id;
    elsif p_currency = 'ZAR' then
      update credit_wallets set balance_zar = balance_zar - p_premium_amount,
        updated_at = now() where agent_id = p_agent_id;
    else
      update credit_wallets set balance_usd = balance_usd - p_premium_amount,
        updated_at = now() where agent_id = p_agent_id;
    end if;

    -- Record debit transaction
    insert into credit_transactions (wallet_id, agent_id, type, currency, amount,
      balance_after, description, reference_id, performed_by)
    select v_wallet.id, p_agent_id, 'debit', p_currency, p_premium_amount,
      case p_currency
        when 'MZN' then v_wallet.balance_mzn - p_premium_amount
        when 'ZAR' then v_wallet.balance_zar - p_premium_amount
        else v_wallet.balance_usd - p_premium_amount end,
      'Policy sale: ' || p_plate, v_policy_id, p_agent_id;
  end if;

  -- Agent commission
  select commission_rate, parent_agent_id into v_agent_commission, v_parent_id
  from profiles where id = p_agent_id;
  insert into commissions (policy_id, agent_id, commission_type, rate, amount, currency)
  values (v_policy_id, p_agent_id, 'direct', v_agent_commission,
    round(p_premium_amount * v_agent_commission / 100, 2), p_currency);

  -- Override commission for parent
  if v_parent_id is not null then
    select sub_agent_override_rate into v_parent_rate from profiles where id = v_parent_id;
    insert into commissions (policy_id, agent_id, commission_type, rate, amount, currency)
    values (v_policy_id, v_parent_id, 'override', v_parent_rate,
      round(p_premium_amount * v_parent_rate / 100, 2), p_currency);
  end if;

  return v_policy_id;
end;
$$;

-- ============================================================
-- Storage: policy documents bucket
-- ============================================================

insert into storage.buckets (id, name, public)
values ('policy-documents', 'policy-documents', false)
on conflict (id) do nothing;

create policy "policy_documents_select" on storage.objects for select
  using (bucket_id = 'policy-documents' and auth.role() = 'authenticated');
create policy "policy_documents_insert" on storage.objects for insert
  with check (bucket_id = 'policy-documents' and auth.role() = 'authenticated');
