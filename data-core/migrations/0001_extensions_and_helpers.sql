-- 0001_extensions_and_helpers.sql
-- Extensions and shared helper functions for the AACTIVATED Data Core.
--
-- pgcrypto : gen_random_uuid() on PostgreSQL < 13 (built in on 13+, harmless there).
-- btree_gist: lets EXCLUDE constraints mix equality (uuid) with range overlap,
--             used to forbid overlapping effective-dated cost/relationship windows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Keeps updated_at honest on every UPDATE without trusting application code.
CREATE OR REPLACE FUNCTION data_core_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
