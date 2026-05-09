-- Run this in Supabase SQL Editor — adds the 3 new columns to policies
-- This is all you need if you want to avoid replacing the DB function.

ALTER TABLE policies ADD COLUMN IF NOT EXISTS border text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_type text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_url text;
