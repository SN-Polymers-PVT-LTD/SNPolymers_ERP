-- Migration 008: Atomic OTP attempt counter used by otp.service.js
CREATE OR REPLACE FUNCTION public.increment_otp_attempts(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_attempts integer;
BEGIN
  UPDATE public.otp_requests
  SET attempts = attempts + 1
  WHERE id = p_id
  RETURNING attempts INTO new_attempts;

  RETURN COALESCE(new_attempts, 0);
END;
$$;
