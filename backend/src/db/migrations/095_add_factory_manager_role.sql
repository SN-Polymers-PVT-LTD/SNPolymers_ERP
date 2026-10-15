-- Canonical FM identity uses the existing authentication/account system.
ALTER TABLE public.authorised_users DROP CONSTRAINT authorised_users_role_check;
ALTER TABLE public.authorised_users ADD CONSTRAINT authorised_users_role_check
  CHECK (role IN ('admin', 'je', 'zo', 'ho', 'accounts', 'factory_manager'));

-- A DB trigger makes role changes and session revocation atomic, including
-- updates outside the Admin controller. Unchanged roles preserve sessions.
CREATE FUNCTION public.revoke_sessions_on_account_access_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS FALSE THEN
    UPDATE public.sessions SET is_active = false, logout_at = now()
      WHERE user_id = NEW.id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER revoke_sessions_on_account_access_change
AFTER UPDATE OF role, is_active ON public.authorised_users
FOR EACH ROW EXECUTE FUNCTION public.revoke_sessions_on_account_access_change();
REVOKE ALL ON FUNCTION public.revoke_sessions_on_account_access_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_sessions_on_account_access_change() TO service_role;
