-- ===========================================================================
-- Migration 26: Zonal Office Mapping, Ledgers, and Returns
-- DB: PostgreSQL (Supabase)
-- Target Workspace: Zenoguy/SNPolymers
-- ===========================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Table: je_zo_mappings (User Mapping Module)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.je_zo_mappings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    je_user_id     VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    zo_user_id     VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    is_active      BOOLEAN DEFAULT true NOT NULL,
    assigned_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
    assigned_by    VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    deactivated_at TIMESTAMPTZ,
    deactivated_by VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT
);

ALTER TABLE public.je_zo_mappings OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS idx_je_zo_mappings_active_unique 
    ON public.je_zo_mappings (je_user_id) 
    WHERE (is_active = true);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Table: zo_balances (Available Balances)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zo_balances (
    zo_user_id        VARCHAR PRIMARY KEY REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    available_balance NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
    updated_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_zo_balance_positive CHECK (available_balance >= 0.00)
);

ALTER TABLE public.zo_balances OWNER TO postgres;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Schema Alteration: Add zo_user_id to projects_master
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.projects_master 
ADD COLUMN IF NOT EXISTS zo_user_id VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Table: work_order_mappings (Work Order Mapping Module)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_order_mappings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_no  VARCHAR NOT NULL REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
    je_user_id     VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    is_active      BOOLEAN DEFAULT true NOT NULL,
    reason         VARCHAR NOT NULL CHECK (reason IN ('Assigned', 'Transferred', 'Removed', 'Project Closed')),
    assigned_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
    assigned_by    VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    deactivated_at TIMESTAMPTZ,
    deactivated_by VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT
);

ALTER TABLE public.work_order_mappings OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_order_mappings_active_unique
    ON public.work_order_mappings (work_order_no, je_user_id)
    WHERE (is_active = true);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Table: zo_fund_ledger (Transaction Log)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zo_fund_ledger (
    ledger_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zo_user_id       VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    transaction_type VARCHAR NOT NULL CHECK (transaction_type IN ('ALLOCATION', 'REQUISITION_APPROVAL', 'RETURN', 'TRANSFER')),
    reference_type   VARCHAR NOT NULL CHECK (reference_type IN ('FUND_REQUEST', 'REQUISITION', 'RETURN')),
    reference_id     UUID NOT NULL, 
    amount           NUMERIC(18,2) NOT NULL,
    work_order_no    VARCHAR REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
    created_by       VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT
);

ALTER TABLE public.zo_fund_ledger OWNER TO postgres;

-- Guard against double-credits/double-spending by enforcing unique transaction keys
CREATE UNIQUE INDEX IF NOT EXISTS idx_zo_fund_ledger_ref_unique 
    ON public.zo_fund_ledger (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_zo_fund_ledger_zo ON public.zo_fund_ledger(zo_user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Table: excess_fund_returns (Returns Module)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.excess_fund_returns (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zo_user_id       VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    work_order_no    VARCHAR NOT NULL REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
    requested_amount NUMERIC(18,2) NOT NULL CHECK (requested_amount > 0.00),
    status           VARCHAR NOT NULL CHECK (status IN ('Requested', 'Completed', 'Awaiting HO Review', 'Rejected', 'Cancelled')),
    remarks_ho       TEXT,
    remarks_zo       TEXT,
    requested_by     VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    actioned_by      VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at       TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.excess_fund_returns OWNER TO postgres;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Schema Alterations for Existing Tables
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS zo_user_id VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT;
ALTER TABLE public.daily_progress_reports ADD COLUMN IF NOT EXISTS zo_user_id VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT;
ALTER TABLE public.fund_requests ADD COLUMN IF NOT EXISTS work_order_no VARCHAR REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Database Triggers & Verification Functions
-- ────────────────────────────────────────────────────────────────────────────

-- A. Validate Roles before inserting into je_zo_mappings
CREATE OR REPLACE FUNCTION public.fn_validate_je_zo_mapping_roles()
RETURNS TRIGGER AS $$
DECLARE
    v_je_role VARCHAR;
    v_zo_role VARCHAR;
BEGIN
    SELECT role INTO v_je_role FROM public.authorised_users WHERE mobile_number = NEW.je_user_id;
    SELECT role INTO v_zo_role FROM public.authorised_users WHERE mobile_number = NEW.zo_user_id;

    IF v_je_role != 'je' THEN
        RAISE EXCEPTION 'Target user (%) is not a Junior Engineer.', NEW.je_user_id;
    END IF;

    IF v_zo_role != 'zo' THEN
        RAISE EXCEPTION 'Target user (%) is not a Zonal Office user.', NEW.zo_user_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_validate_je_zo_mapping_roles
    BEFORE INSERT OR UPDATE ON public.je_zo_mappings
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_je_zo_mapping_roles();

-- B. Auto-Initialize Balance on ZO Creation
CREATE OR REPLACE FUNCTION public.fn_init_zo_balance_on_user_creation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role = 'zo' THEN
        INSERT INTO public.zo_balances (zo_user_id, available_balance)
        VALUES (NEW.mobile_number, 0.00)
        ON CONFLICT (zo_user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_init_zo_balance_on_user_creation
    AFTER INSERT OR UPDATE OF role ON public.authorised_users
    FOR EACH ROW EXECUTE FUNCTION public.fn_init_zo_balance_on_user_creation();

-- C. Validate Work Order Mapping: Zonal Consistency Trigger
CREATE OR REPLACE FUNCTION public.fn_validate_work_order_mapping_zonal_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_je_zo   VARCHAR;
    v_wo_zo   VARCHAR;
BEGIN
    -- 1. Get the ZO of the JE being assigned
    SELECT zo_user_id INTO v_je_zo 
      FROM public.je_zo_mappings 
     WHERE je_user_id = NEW.je_user_id AND is_active = true;

    IF v_je_zo IS NULL THEN
        RAISE EXCEPTION 'Junior Engineer % is not assigned to any active Zonal Office.', NEW.je_user_id;
    END IF;

    -- 2. Get the ZO of the Work Order
    SELECT zo_user_id INTO v_wo_zo
      FROM public.projects_master
     WHERE work_order_no = NEW.work_order_no;

    IF v_wo_zo IS NULL THEN
        RAISE EXCEPTION 'Work Order % has no assigned owning Zonal Office.', NEW.work_order_no;
    END IF;

    -- 3. Block if they differ
    IF v_wo_zo != v_je_zo THEN
        RAISE EXCEPTION 'Mismatched ZO assignment. Junior Engineer belongs to ZO %, but Work Order belongs to ZO %.',
            v_je_zo, v_wo_zo;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_validate_work_order_mapping_zonal_consistency
    BEFORE INSERT OR UPDATE ON public.work_order_mappings
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_work_order_mapping_zonal_consistency();

-- D. Audit Triggers
CREATE OR REPLACE FUNCTION public.fn_audit_zonal_modules()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
        COALESCE(NEW.assigned_by, NEW.requested_by, 'SYSTEM'),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id::VARCHAR, NEW.zo_user_id),
        CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_audit_je_zo_mappings AFTER INSERT OR UPDATE ON public.je_zo_mappings FOR EACH ROW EXECUTE FUNCTION public.fn_audit_zonal_modules();
CREATE OR REPLACE TRIGGER trg_audit_work_order_mappings AFTER INSERT OR UPDATE ON public.work_order_mappings FOR EACH ROW EXECUTE FUNCTION public.fn_audit_zonal_modules();
CREATE OR REPLACE TRIGGER trg_audit_excess_fund_returns AFTER INSERT OR UPDATE ON public.excess_fund_returns FOR EACH ROW EXECUTE FUNCTION public.fn_audit_zonal_modules();
