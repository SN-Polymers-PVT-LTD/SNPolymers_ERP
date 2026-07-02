-- Migration: Remove 'staff' role from authorised_users and update check constraint
-- DB: PostgreSQL (Supabase)

-- 1. Update any existing users with role 'staff' to 'je' to avoid violating the check constraint
UPDATE authorised_users
SET role = 'je'
WHERE role = 'staff';

-- 2. Change the default value of the role column from 'staff' to 'je'
ALTER TABLE authorised_users ALTER COLUMN role SET DEFAULT 'je';

-- 3. Drop the old check constraint on the role column
DO $$
DECLARE
    r RECORD;
BEGIN
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

-- 4. Add the new CHECK constraint excluding 'staff'
ALTER TABLE authorised_users
  ADD CONSTRAINT authorised_users_role_check
  CHECK (role IN ('admin', 'je', 'zo', 'ho'));
