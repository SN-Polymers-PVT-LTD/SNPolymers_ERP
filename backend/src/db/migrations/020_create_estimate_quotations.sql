-- Migration: 020_create_estimate_quotations.sql
-- Description: Create estimate_quotations table, storage bucket, lock RPC, and audit triggers.

CREATE TABLE public.estimate_quotations (
  quotation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id    uuid NOT NULL REFERENCES project_cost_estimates(estimate_id),
  storage_path   text NOT NULL,
  original_filename varchar NOT NULL,
  vendor_label   varchar(100),                             -- Optional, editable only while unlocked
  flagged_for_replacement boolean NOT NULL DEFAULT false,  -- ZO/HO toggle, no text/history
  file_size      bigint NOT NULL,                          -- Size in bytes
  uploaded_by    varchar NOT NULL,                         -- req.user.mobile_number
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  is_locked      boolean NOT NULL DEFAULT false,           -- Permanent freeze flag
  locked_at      timestamptz,
  is_deleted     boolean NOT NULL DEFAULT false,           -- Soft delete
  deleted_by     varchar,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()        -- Handled explicitly by backend JS controller
);

CREATE INDEX idx_estimate_quotations_estimate_id ON estimate_quotations(estimate_id);

-- Storage bucket provisioning (Private bucket, 15MB file size limit, PDF only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('estimate-quotations', 'estimate-quotations', false, 15728640, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lock RPC invoked during the Final Approved transition in backend workflow controller
CREATE OR REPLACE FUNCTION public.lock_estimate_quotations(p_estimate_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.estimate_quotations
  SET is_locked = true, locked_at = now()
  WHERE estimate_id = p_estimate_id
    AND is_deleted = false
    AND is_locked = false;
END;
$$;

-- Audit Trigger Function (Shaped like public.audit_fund_reports_changes)
CREATE OR REPLACE FUNCTION public.audit_estimate_quotations_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
      NEW.uploaded_by,
      'CREATE',
      'Estimate Quotation',
      NEW.quotation_id::VARCHAR,
      NULL,
      jsonb_build_object(
        'estimate_id', NEW.estimate_id,
        'original_filename', NEW.original_filename,
        'vendor_label', NEW.vendor_label,
        'file_size', NEW.file_size
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Audit soft-deletions: is_deleted flipped false -> true
    IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted AND NEW.is_deleted = TRUE THEN
      INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (
        NEW.deleted_by,
        'SOFT_DELETE',
        'Estimate Quotation',
        NEW.quotation_id::VARCHAR,
        jsonb_build_object('is_deleted', OLD.is_deleted),
        jsonb_build_object('is_deleted', NEW.is_deleted, 'deleted_by', NEW.deleted_by, 'deleted_at', NEW.deleted_at)
      );
    -- Audit workflow locks: is_locked flipped false -> true
    ELSIF NEW.is_locked IS DISTINCT FROM OLD.is_locked AND NEW.is_locked = TRUE THEN
      INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (
        NULL,
        'LOCK',
        'Estimate Quotation',
        NEW.quotation_id::VARCHAR,
        jsonb_build_object('is_locked', OLD.is_locked),
        jsonb_build_object('is_locked', NEW.is_locked, 'locked_at', NEW.locked_at)
      );
    -- Note: updates to flagged_for_replacement are intentionally NOT audited
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Create audit trigger on the table
CREATE TRIGGER trg_audit_estimate_quotations_changes
AFTER INSERT OR UPDATE ON public.estimate_quotations
FOR EACH ROW EXECUTE FUNCTION public.audit_estimate_quotations_changes();
