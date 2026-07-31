-- Migration 00E: Seed default test materials and base test users

INSERT INTO public.authorised_users (mobile_number, role, is_active, display_name)
VALUES 
  ('+918000000001', 'admin', true, 'System Admin Test User'),
  ('+918276071523', 'admin', true, 'Test Admin User')
ON CONFLICT (mobile_number) DO NOTHING;

INSERT INTO public.material_master ("Material_Main_Head", "Material_Sub_Head", "Material_Details", "M_Unit", is_active, created_by)
VALUES 
  ('Pipes', 'PVC', 'Standard PVC Pipe', 'meter', true, 'SYSTEM'),
  ('Cement', 'PPC', 'Standard PPC Cement', 'bag', true, 'SYSTEM'),
  ('Sand', 'Fine', 'Fine River Sand', 'cft', true, 'SYSTEM')
ON CONFLICT DO NOTHING;
