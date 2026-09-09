-- Migration 00E: Seed default test materials and base test users

-- Note: +918000000001 is deliberately NOT seeded here as an admin — it is
-- reused throughout tests/vitest/milestones/*.test.js as a generic 'zo' test
-- fixture identity (upserted with role 'zo'), which previously collided with
-- this seed and silently rewrote it away from 'admin' mid-suite, corrupting
-- attribution of rows (e.g. indian_bank_master) seeded against it below by
-- migrations 026/051. +918276071523 is the suite's stable, untouched admin.
INSERT INTO public.authorised_users (mobile_number, role, is_active, display_name)
VALUES
  ('+918276071523', 'admin', true, 'Test Admin User')
ON CONFLICT (mobile_number) DO NOTHING;

INSERT INTO public.material_master ("Material_Main_Head", "Material_Sub_Head", "Material_Details", "M_Unit", is_active, created_by)
VALUES 
  ('Pipes', 'PVC', 'Standard PVC Pipe', 'meter', true, 'SYSTEM'),
  ('Cement', 'PPC', 'Standard PPC Cement', 'bag', true, 'SYSTEM'),
  ('Sand', 'Fine', 'Fine River Sand', 'cft', true, 'SYSTEM')
ON CONFLICT DO NOTHING;
