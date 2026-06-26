-- Migration 22: Create increment_otp_attempts function for atomic increments
-- DB: PostgreSQL (Supabase)

CREATE OR REPLACE FUNCTION increment_otp_attempts(p_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_attempts INTEGER;
BEGIN
  UPDATE otp_requests
  SET attempts = attempts + 1
  WHERE id = p_id
  RETURNING attempts INTO v_attempts;
  
  RETURN v_attempts;
END;
$$ LANGUAGE plpgsql;
