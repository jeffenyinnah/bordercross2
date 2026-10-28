-- ============================================================
-- Security hardening (Part A, Phase 1)
--  1. Agents can no longer escalate role / commission via PostgREST
--  2. Policy creation computes premium server-side and uses auth.uid()
--  3. Direct inserts into policies are blocked (RPC only)
--  4. Atomic, admin-only wallet top-up
--  5. Race-free policy numbering
--  6. Policy documents scoped to owner/admin
-- ============================================================

-- Helper: current user's role (search_path pinned, qualified names)
create or replace function public.get_user_role()
returns text language sql security definer stable set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ------------------------------------------------------------
-- 1. PROFILES: block self-escalation
-- ------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'service_role' or public.get_user_role() = 'admin' then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.role is distinct from old.role
    or new.email is distinct from old.email
    or new.commission_rate is distinct from old.commission_rate
    or new.sub_agent_override_rate is distinct from old.sub_agent_override_rate
    or new.parent_agent_id is distinct from old.parent_agent_id
    or new.is_active is distinct from old.is_active
  then
    raise exception 'Not allowed to change protected profile fields' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update
  using (public.get_user_role() = 'admin' or id = auth.uid())
  with check (public.get_user_role() = 'admin' or id = auth.uid());

-- ------------------------------------------------------------
-- 3. POLICIES: inserts only through create_policy_with_debit;
--    admins may update (cancel/edit). Previously agents could insert
--    a policy directly via REST without paying.
-- ------------------------------------------------------------
drop policy if exists "policies_insert" on public.policies;
drop policy if exists "policies_update" on public.policies;
create policy "policies_update" on public.policies for update
  using (public.get_user_role() = 'admin')
  with check (public.get_user_role() = 'admin');

-- ------------------------------------------------------------
-- 5. Race-free policy numbering (BORDER-YYYY-NNNNNN)
-- ------------------------------------------------------------
create table if not exists public.policy_number_counters (
  border_code text not null,
  year integer not null,
  last_seq integer not null default 0,
  primary key (border_code, year)
);
alter table public.policy_number_counters enable row level security;
-- no policies: only SECURITY DEFINER functions touch this table

-- Seed from existing numbers so new ones never collide
insert into public.policy_number_counters (border_code, year, last_seq)
select split_part(policy_number, '-', 1),
       split_part(policy_number, '-', 2)::integer,
       max(split_part(policy_number, '-', 3)::integer)
from public.policies
where policy_number ~ '^[A-Z]+-[0-9]{4}-[0-9]+$'
group by 1, 2
on conflict (border_code, year) do update
  set last_seq = greatest(public.policy_number_counters.last_seq, excluded.last_seq);

create or replace function public.generate_policy_number(p_border_code text default 'BORD')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(coalesce(nullif(p_border_code, ''), 'BORD'));
  v_year integer := extract(year from now())::integer;
  v_seq integer;
begin
  insert into public.policy_number_counters (border_code, year, last_seq)
  values (v_code, v_year, 1)
  on conflict (border_code, year)
    do update set last_seq = public.policy_number_counters.last_seq + 1
  returning last_seq into v_seq;

  return v_code || '-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke execute on function public.generate_policy_number(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. create_policy_with_debit: premium priced server-side,
--    agent = caller (admins may issue on behalf of an agent)
-- ------------------------------------------------------------
drop function if exists public.create_policy_with_debit(
  uuid, text, uuid, text, text, numeric, text, text, text, integer,
  text, text, date, text, text, text, text, text, text
);

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

  -- Agents always issue as themselves; admins may issue on behalf of an agent
  v_agent_id := case when v_caller_role = 'admin' and p_agent_id is not null
                     then p_agent_id else v_caller end;
  if v_agent_id <> v_caller then
    select is_active into v_agent_active from public.profiles where id = v_agent_id;
    if v_agent_active is distinct from true then
      raise exception 'Agent is inactive or does not exist';
    end if;
  end if;

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

  -- Price every selected (distinct, active) vehicle type from the DB
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

  insert into public.policies (policy_number, agent_id, client_name, client_id_number,
    client_nationality, vehicle_type_id, policy_type, currency, premium_amount,
    premium_mzn_equivalent, plate_number, vehicle_brand, vehicle_model, vehicle_year,
    engine_number, chassis_number, start_date, end_date, notes,
    border, document_type, document_url)
  values (public.generate_policy_number(coalesce(v_border_code, 'BORD')), v_agent_id,
    p_client_name, p_client_id, p_nationality, p_vehicle_type_ids[1], p_policy_type,
    p_currency, v_premium, v_premium_mzn, upper(p_plate), p_brand, p_model, p_year,
    p_engine, p_chassis, p_start_date, v_end_date, v_notes,
    p_border, p_document_type, p_document_url)
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

    insert into public.credit_transactions (wallet_id, agent_id, type, currency, amount,
      balance_after, description, reference_id, performed_by)
    values (v_wallet.id, v_agent_id, 'debit', p_currency, v_premium, v_balance_after,
      'Policy sale: ' || upper(p_plate), v_policy_id, v_caller);
  end if;

  -- Agent commission
  select commission_rate, parent_agent_id into v_agent_commission, v_parent_id
  from public.profiles where id = v_agent_id;
  insert into public.commissions (policy_id, agent_id, commission_type, rate, amount, currency)
  values (v_policy_id, v_agent_id, 'direct', v_agent_commission,
    round(v_premium * v_agent_commission / 100, 2), p_currency);

  -- Override commission for parent
  if v_parent_id is not null then
    select sub_agent_override_rate into v_parent_rate from public.profiles where id = v_parent_id;
    insert into public.commissions (policy_id, agent_id, commission_type, rate, amount, currency)
    values (v_policy_id, v_parent_id, 'override', v_parent_rate,
      round(v_premium * v_parent_rate / 100, 2), p_currency);
  end if;

  return v_policy_id;
end;
$$;

revoke execute on function public.create_policy_with_debit(
  uuid[], text, text, text, text, text, text, date, integer, text, text,
  text, text, text, text, text, text, uuid
) from public, anon;
grant execute on function public.create_policy_with_debit(
  uuid[], text, text, text, text, text, text, date, integer, text, text,
  text, text, text, text, text, text, uuid
) to authenticated;

-- ------------------------------------------------------------
-- 4. Atomic, admin-only wallet top-up
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
  if public.get_user_role() is distinct from 'admin' then
    raise exception 'Only admins can top up wallets' using errcode = '42501';
  end if;
  if p_currency not in ('MZN', 'ZAR', 'USD') then
    raise exception 'Invalid currency';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  update public.credit_wallets set
    balance_mzn = balance_mzn + case when p_currency = 'MZN' then p_amount else 0 end,
    balance_zar = balance_zar + case when p_currency = 'ZAR' then p_amount else 0 end,
    balance_usd = balance_usd + case when p_currency = 'USD' then p_amount else 0 end,
    updated_at = now()
  where agent_id = p_agent_id
  returning id, case p_currency when 'MZN' then balance_mzn
                                when 'ZAR' then balance_zar
                                else balance_usd end
    into v_wallet_id, v_balance_after;

  if v_wallet_id is null then
    raise exception 'Wallet not found for this agent';
  end if;

  insert into public.credit_transactions (wallet_id, agent_id, type, currency, amount,
    balance_after, description, performed_by)
  values (v_wallet_id, p_agent_id, 'credit', p_currency, p_amount, v_balance_after,
    coalesce(nullif(p_description, ''), 'Top-up by admin'), auth.uid());

  return v_balance_after;
end;
$$;

revoke execute on function public.top_up_wallet(uuid, text, numeric, text) from public, anon;
grant execute on function public.top_up_wallet(uuid, text, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- 6. Policy documents: uploads go under <uid>/..., readable by owner or admin
-- ------------------------------------------------------------
drop policy if exists "policy_documents_select" on storage.objects;
drop policy if exists "policy_documents_insert" on storage.objects;

create policy "policy_documents_select" on storage.objects for select
  using (
    bucket_id = 'policy-documents' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.get_user_role() = 'admin'
    )
  );
create policy "policy_documents_insert" on storage.objects for insert
  with check (
    bucket_id = 'policy-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
