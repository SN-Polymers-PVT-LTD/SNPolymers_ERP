CREATE FUNCTION public.preserve_indian_bank_creator() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.created_by := OLD.created_by;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_indian_bank_creator() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER preserve_indian_bank_creator
BEFORE UPDATE ON public.indian_bank_master
FOR EACH ROW EXECUTE FUNCTION public.preserve_indian_bank_creator();
