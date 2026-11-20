-- Match statutory rules: NULL means ongoing, with original publication range retained.
ALTER TABLE public.payroll_policy_master_revisions ALTER COLUMN effective_to DROP NOT NULL;
ALTER TABLE public.payroll_policy_master_revisions DROP CONSTRAINT payroll_policy_publication;
ALTER TABLE public.payroll_policy_master_revisions DROP CONSTRAINT payroll_policy_audit_complete;
ALTER TABLE public.payroll_policy_master_revisions ADD CONSTRAINT payroll_policy_publication CHECK(
 (status='DRAFT' AND published_by IS NULL AND published_at IS NULL AND revision_number IS NULL AND approval_reference IS NULL AND published_effective_to IS NULL)
 OR (status='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL AND revision_number IS NOT NULL AND revision_number>0 AND approval_reference IS NOT NULL AND length(btrim(approval_reference)) BETWEEN 1 AND 2000
 AND (published_effective_to IS NULL OR (isfinite(published_effective_to) AND effective_to IS NOT NULL AND published_effective_to>=effective_to)))
);
-- Resolution, exclusion ranges, preview and controlled shortening already handle
-- NULL upper bounds (migrations 126 and 143). Published values stay immutable.
NOTIFY pgrst,'reload schema';
