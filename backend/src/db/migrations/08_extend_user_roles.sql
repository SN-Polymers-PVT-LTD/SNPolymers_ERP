-- Migration: Extend authorised_users role column for Phase 2 hierarchy
-- DB: PostgreSQL (Supabase)

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Query pg_constraint and pg_attribute directly to reliably find and drop 
    -- any CHECK constraints on the 'role' column of 'authorised_users'
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'authorised_users'
          AND c.contype = 'c'
          AND (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'role') = ANY(c.conkey)
    LOOP
        EXECUTE 'ALTER TABLE authorised_users DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
    END LOOP;
END $$;

ALTER TABLE authorised_users
  ADD CONSTRAINT authorised_users_role_check
  CHECK (role IN ('staff', 'admin', 'je', 'zo', 'ho'));
