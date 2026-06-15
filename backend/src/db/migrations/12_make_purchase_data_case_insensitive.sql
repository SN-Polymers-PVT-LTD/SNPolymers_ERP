-- Migration: Make purchase_data name case-insensitive unique & add toggle function
-- DB: PostgreSQL (Supabase)

ALTER TABLE purchase_data DROP CONSTRAINT IF EXISTS purchase_data_name_key;

DROP INDEX IF EXISTS purchase_data_name_unique;
CREATE UNIQUE INDEX purchase_data_name_unique ON purchase_data (LOWER(name));

-- Atomic toggle function for purchase option status
CREATE OR REPLACE FUNCTION toggle_purchase_option_status(p_id UUID)
RETURNS purchase_data
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_row purchase_data;
BEGIN
  UPDATE purchase_data
  SET is_active = NOT is_active
  WHERE id = p_id
  RETURNING * INTO v_updated_row;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase option with ID % not found.', p_id;
  END IF;
  
  RETURN v_updated_row;
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_purchase_option_status(UUID) TO service_role;
