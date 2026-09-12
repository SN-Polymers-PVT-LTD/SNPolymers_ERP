-- Migration 068: claim attachment deletion in PostgreSQL before touching Storage.

ALTER TYPE public.requisition_attachment_status_enum
  ADD VALUE IF NOT EXISTS 'deleting';

ALTER TABLE public.requisition_attachments
  ADD COLUMN IF NOT EXISTS deletion_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.acquire_requisition_attachment_delete(
  p_attachment_id uuid,
  p_actor varchar,
  p_kind varchar
) RETURNS public.requisition_attachments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attachment public.requisition_attachments;
  v_is_admin boolean;
BEGIN
  SELECT (role = 'admin') INTO v_is_admin
  FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  SELECT * INTO v_attachment FROM public.requisition_attachments
  WHERE attachment_id = p_attachment_id AND kind = p_kind FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_attachment.uploaded_by <> p_actor AND COALESCE(v_is_admin, false) = false THEN
    RAISE EXCEPTION 'Access denied for attachment.' USING ERRCODE = '42501';
  END IF;
  IF v_attachment.status = 'committed' THEN
    RAISE EXCEPTION 'This attachment is already attached to a saved requisition and cannot be deleted here.' USING ERRCODE = 'STA08';
  END IF;
  IF v_attachment.status = 'pending' THEN
    UPDATE public.requisition_attachments
    SET status = 'deleting', deletion_started_at = now()
    WHERE attachment_id = p_attachment_id RETURNING * INTO v_attachment;
  END IF;
  RETURN v_attachment;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_requisition_attachment_delete(p_attachment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.requisition_attachments WHERE attachment_id = p_attachment_id AND status = 'deleting';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_requisition_attachment_delete(uuid, varchar, varchar) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_requisition_attachment_delete(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_requisition_attachment_delete(uuid, varchar, varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_requisition_attachment_delete(uuid) TO service_role;
