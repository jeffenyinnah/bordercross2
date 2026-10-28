-- ============================================================
-- Insurers run their own business (SaaS):
--   * every insurer has its own vehicle categories and prices;
--   * the platform keeps a default price list that new insurers start from;
--   * only the insurer's own admins top up its agents' wallets.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Default price list (platform). Never sold from directly.
-- ------------------------------------------------------------
create table public.vehicle_type_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_mzn numeric not null check (price_mzn > 0),
  price_mzn_annual numeric check (price_mzn_annual > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.vehicle_type_templates enable row level security;
create policy vtt_admin on public.vehicle_type_templates for all
  using ((select public.get_user_role()) = 'admin')
  with check ((select public.get_user_role()) = 'admin');

insert into public.vehicle_type_templates (name, description, price_mzn, price_mzn_annual, is_active)
select name, description, price_mzn, price_mzn_annual, true
from public.vehicle_types
where insurer_id is null and is_active;

-- ------------------------------------------------------------
-- 2. Shared rows become insurer-owned. The oldest insurer keeps the
--    existing rows (and so its policies keep their links); every other
--    insurer gets a copy, and any of its policies are re-pointed to it.
-- ------------------------------------------------------------
do $$
declare
  v_first uuid := (select id from public.insurers order by created_at, id limit 1);
  v_ins record;
begin
  if v_first is null then
    return;
  end if;

  for v_ins in select id from public.insurers where id <> v_first loop
    with copied as (
      insert into public.vehicle_types (name, description, price_mzn, price_mzn_annual, is_active, insurer_id)
      select name, description, price_mzn, price_mzn_annual, is_active, v_ins.id
      from public.vehicle_types where insurer_id is null
      returning id, name
    )
    update public.policies p
       set vehicle_type_id = c.id
      from public.vehicle_types old, copied c
     where p.insurer_id = v_ins.id
       and p.vehicle_type_id = old.id
       and old.insurer_id is null
       and c.name = old.name;
  end loop;

  update public.vehicle_types set insurer_id = v_first where insurer_id is null;
end $$;

alter table public.vehicle_types alter column insurer_id set not null;
create index vehicle_types_insurer_idx on public.vehicle_types (insurer_id, name);

-- ------------------------------------------------------------
-- 3. A new insurer starts with a copy of the default list
-- ------------------------------------------------------------
create or replace function public.seed_insurer_price_list()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vehicle_types (name, description, price_mzn, price_mzn_annual, is_active, insurer_id)
  select name, description, price_mzn, price_mzn_annual, true, new.id
  from public.vehicle_type_templates
  where is_active;
  return new;
end;
$$;

create trigger insurers_seed_price_list
  after insert on public.insurers
  for each row execute function public.seed_insurer_price_list();

-- ------------------------------------------------------------
-- 4. Vehicle types: readable by the platform admin and the insurer's own
--    people; written only by the insurer's admins.
-- ------------------------------------------------------------
drop policy if exists vt_select on public.vehicle_types;
drop policy if exists vt_all on public.vehicle_types;

create policy vt_select on public.vehicle_types for select
  using ((select public.get_user_role()) = 'admin' or insurer_id = (select public.my_insurer_id()));

create policy vt_insert on public.vehicle_types for insert
  with check ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id()));

create policy vt_update on public.vehicle_types for update
  using ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id()))
  with check ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id()));

create policy vt_delete on public.vehicle_types for delete
  using ((select public.get_user_role()) = 'insurer_admin' and insurer_id = (select public.my_insurer_id()));

-- ------------------------------------------------------------
-- 5. Wallet top-up: the insurer's own admins only
-- ------------------------------------------------------------
create or replace function public.top_up_wallet(
  p_agent_id uuid,
  p_currency text,
  p_amount numeric,
  p_description text default null
)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  v_wallet_id uuid;
  v_balance_after numeric;
begin
  if public.get_user_role() is distinct from 'insurer_admin' or not exists (
    select 1 from public.profiles
    where id = p_agent_id and role = 'agent' and insurer_id = public.my_insurer_id()
  ) then
    raise exception 'Only the agent''s insurer can top up this wallet' using errcode = '42501';
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
