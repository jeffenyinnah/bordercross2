-- ============================================================
-- BORDERCROSS Migration — Run this in Supabase SQL Editor
-- ============================================================

-- 1. Border posts table
CREATE TABLE IF NOT EXISTS border_posts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,   -- 4-letter code used in policy numbers
  province text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE border_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "border_posts_select" ON border_posts;
DROP POLICY IF EXISTS "border_posts_all" ON border_posts;
CREATE POLICY "border_posts_select" ON border_posts FOR SELECT USING (true);
CREATE POLICY "border_posts_all" ON border_posts FOR ALL USING (get_user_role() = 'admin');

-- Seed border posts
INSERT INTO border_posts (name, code, province) VALUES
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
ON CONFLICT (code) DO NOTHING;

-- 2. Add new columns to policies
ALTER TABLE policies ADD COLUMN IF NOT EXISTS border text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_type text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_url text;

-- 3. Update generate_policy_number to accept a border code
CREATE OR REPLACE FUNCTION generate_policy_number(p_border_code text DEFAULT 'BORD')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  seq integer;
  year_str text := to_char(now(), 'YYYY');
BEGIN
  SELECT count(*) + 1 INTO seq FROM policies
  WHERE extract(year FROM created_at) = extract(year FROM now());
  RETURN upper(p_border_code) || '-' || year_str || '-' || lpad(seq::text, 6, '0');
END;
$$;

-- 4. Replace create_policy_with_debit to support border + documents
CREATE OR REPLACE FUNCTION create_policy_with_debit(
  p_agent_id uuid, p_client_name text, p_vehicle_type_id uuid,
  p_policy_type text, p_currency text, p_premium_amount numeric,
  p_plate text, p_brand text, p_model text, p_year integer,
  p_engine text, p_chassis text, p_start_date date, p_client_id text,
  p_nationality text, p_notes text,
  p_border text DEFAULT NULL,
  p_document_type text DEFAULT NULL,
  p_document_url text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wallet credit_wallets%rowtype;
  v_policy_id uuid;
  v_end_date date;
  v_mzn_rate numeric;
  v_premium_mzn numeric;
  v_agent_commission numeric;
  v_parent_id uuid;
  v_parent_rate numeric;
  v_border_code text;
BEGIN
  -- Resolve border code (lookup by name or id)
  IF p_border IS NOT NULL AND p_border <> '' THEN
    SELECT code INTO v_border_code FROM border_posts
    WHERE name = p_border OR id::text = p_border
    LIMIT 1;
  END IF;
  IF v_border_code IS NULL THEN v_border_code := 'BORD'; END IF;

  -- Check wallet balance
  SELECT * INTO v_wallet FROM credit_wallets WHERE agent_id = p_agent_id FOR UPDATE;
  IF v_wallet IS NULL THEN
    -- Admin has no wallet — skip balance check
    v_wallet.id := NULL;
    v_wallet.balance_mzn := 0;
    v_wallet.balance_zar := 0;
    v_wallet.balance_usd := 0;
  ELSE
    IF p_currency = 'MZN' AND v_wallet.balance_mzn < p_premium_amount THEN
      RAISE EXCEPTION 'Insufficient MZN balance';
    ELSIF p_currency = 'ZAR' AND v_wallet.balance_zar < p_premium_amount THEN
      RAISE EXCEPTION 'Insufficient ZAR balance';
    ELSIF p_currency = 'USD' AND v_wallet.balance_usd < p_premium_amount THEN
      RAISE EXCEPTION 'Insufficient USD balance';
    END IF;
  END IF;

  -- Calculate end date
  v_end_date := CASE WHEN p_policy_type = 'annual'
    THEN p_start_date + INTERVAL '365 days'
    ELSE p_start_date + INTERVAL '30 days' END;

  -- Convert premium to MZN
  SELECT rate INTO v_mzn_rate FROM exchange_rates
  WHERE from_currency = p_currency AND to_currency = 'MZN';
  v_premium_mzn := CASE WHEN p_currency = 'MZN' THEN p_premium_amount
    ELSE p_premium_amount * COALESCE(v_mzn_rate, 1) END;

  -- Create policy
  INSERT INTO policies (policy_number, agent_id, client_name, client_id_number,
    client_nationality, vehicle_type_id, policy_type, currency, premium_amount,
    premium_mzn_equivalent, plate_number, vehicle_brand, vehicle_model, vehicle_year,
    engine_number, chassis_number, start_date, end_date, notes,
    border, document_type, document_url)
  VALUES (generate_policy_number(v_border_code), p_agent_id, p_client_name, p_client_id,
    p_nationality, p_vehicle_type_id, p_policy_type, p_currency, p_premium_amount,
    v_premium_mzn, p_plate, p_brand, p_model, p_year, p_engine, p_chassis,
    p_start_date, v_end_date, p_notes,
    p_border, p_document_type, p_document_url)
  RETURNING id INTO v_policy_id;

  -- Deduct from wallet (skip if admin with no wallet)
  IF v_wallet.id IS NOT NULL THEN
    IF p_currency = 'MZN' THEN
      UPDATE credit_wallets SET balance_mzn = balance_mzn - p_premium_amount,
        updated_at = now() WHERE agent_id = p_agent_id;
    ELSIF p_currency = 'ZAR' THEN
      UPDATE credit_wallets SET balance_zar = balance_zar - p_premium_amount,
        updated_at = now() WHERE agent_id = p_agent_id;
    ELSE
      UPDATE credit_wallets SET balance_usd = balance_usd - p_premium_amount,
        updated_at = now() WHERE agent_id = p_agent_id;
    END IF;

    -- Record debit transaction
    INSERT INTO credit_transactions (wallet_id, agent_id, type, currency, amount,
      balance_after, description, reference_id, performed_by)
    SELECT v_wallet.id, p_agent_id, 'debit', p_currency, p_premium_amount,
      CASE p_currency
        WHEN 'MZN' THEN v_wallet.balance_mzn - p_premium_amount
        WHEN 'ZAR' THEN v_wallet.balance_zar - p_premium_amount
        ELSE v_wallet.balance_usd - p_premium_amount END,
      'Policy sale: ' || p_plate, v_policy_id, p_agent_id;
  END IF;

  -- Agent commission
  SELECT commission_rate, parent_agent_id INTO v_agent_commission, v_parent_id
  FROM profiles WHERE id = p_agent_id;
  INSERT INTO commissions (policy_id, agent_id, commission_type, rate, amount, currency)
  VALUES (v_policy_id, p_agent_id, 'direct', v_agent_commission,
    round(p_premium_amount * v_agent_commission / 100, 2), p_currency);

  -- Override commission for parent
  IF v_parent_id IS NOT NULL THEN
    SELECT sub_agent_override_rate INTO v_parent_rate FROM profiles WHERE id = v_parent_id;
    INSERT INTO commissions (policy_id, agent_id, commission_type, rate, amount, currency)
    VALUES (v_policy_id, v_parent_id, 'override', v_parent_rate,
      round(p_premium_amount * v_parent_rate / 100, 2), p_currency);
  END IF;

  RETURN v_policy_id;
END;
$$;

-- 5. Supabase Storage bucket for documents (run separately if needed)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('policy-documents', 'policy-documents', false)
-- ON CONFLICT DO NOTHING;
