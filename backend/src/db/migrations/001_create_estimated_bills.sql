-- ===========================================================================
-- Migration 001: Create Estimated Bills Table
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.estimated_bills (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_no          VARCHAR NOT NULL UNIQUE
                             REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
    estimated_bill_amount  NUMERIC(18,2) NOT NULL CHECK (estimated_bill_amount > 0),
    estimated_payment_date DATE NOT NULL,
    surety_pct             SMALLINT NOT NULL CHECK (surety_pct BETWEEN 0 AND 100),
    remarks                TEXT,
    created_by             VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by             VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.estimated_bills OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_estimated_bills_work_order
    ON public.estimated_bills (work_order_no);

GRANT ALL ON TABLE public.estimated_bills TO anon;
GRANT ALL ON TABLE public.estimated_bills TO authenticated;
GRANT ALL ON TABLE public.estimated_bills TO service_role;

-- Enable Row-Level Security for defense-in-depth consistency with sibling tables.
-- Zero policies added -> defaults to deny-all for `anon` and `authenticated` roles.
-- Backend service_role key bypasses RLS while preventing unauthenticated/direct access.
ALTER TABLE public.estimated_bills ENABLE ROW LEVEL SECURITY;
