-- Migration: 022_add_accounts_role.sql
-- Description: Add 'accounts' as a valid authorised_users.role value.
-- Required for the Accounts HO Approval feature (backend/src/db/migrations/021_create_accounts_ho_approval.sql):
-- its route layer gates Accounts-side endpoints behind role 'accounts', which the existing
-- authorised_users_role_check CHECK constraint (00_full_schema_dump.sql) does not permit.

ALTER TABLE "public"."authorised_users" DROP CONSTRAINT "authorised_users_role_check";

ALTER TABLE "public"."authorised_users" ADD CONSTRAINT "authorised_users_role_check"
    CHECK ((("role")::"text" = ANY ((ARRAY['admin'::character varying, 'je'::character varying, 'zo'::character varying, 'ho'::character varying, 'accounts'::character varying])::"text"[])));
