-- Migration 058: add the persistent Fund Request lifecycle values.
-- This migration intentionally contains only ALTER TYPE. PostgreSQL does not
-- allow a newly-added enum value to be used before the transaction commits.
ALTER TYPE public.fund_request_status_enum ADD VALUE IF NOT EXISTS 'Draft';
ALTER TYPE public.fund_request_status_enum ADD VALUE IF NOT EXISTS 'Returned';
ALTER TYPE public.fund_request_status_enum ADD VALUE IF NOT EXISTS 'Rejected';
