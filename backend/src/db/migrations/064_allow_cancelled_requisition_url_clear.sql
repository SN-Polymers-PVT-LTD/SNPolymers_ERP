-- Migration 064: allow cancelled requisitions to clear their storage URL.
-- Migration 063 may already be applied on development databases, so this
-- corrective migration must remain separate and forward-only.

ALTER TABLE public.requisitions
  ALTER COLUMN requisition_pdf_url DROP NOT NULL;
