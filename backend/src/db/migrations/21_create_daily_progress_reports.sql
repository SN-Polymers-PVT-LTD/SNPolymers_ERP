-- ===========================================================================
-- Migration 21: Phase 5 — Daily Work Progress Reports
-- PREREQUISITE: Migrations 01–20 must have been applied.
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. daily_progress_reports table
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_progress_reports (
  report_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- JE identity (auto-populated from session)
  created_by                   VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  login_date                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Work Order linkage (geo-metadata snapshot stored at creation time)
  work_order_no                VARCHAR NOT NULL REFERENCES projects_master(work_order_no) ON DELETE RESTRICT,

  -- Frozen geographic metadata (snapshot from projects_master at creation time)
  state                        VARCHAR NOT NULL,
  district                     VARCHAR NOT NULL,
  area_code                    VARCHAR NOT NULL,         -- maps to projects_master.zone
  department                   VARCHAR NOT NULL,
  site_details                 TEXT NOT NULL,

  -- JE user-entered fields
  site_visit_date              DATE NOT NULL,
  work_progress_details        TEXT NOT NULL,
  physical_work_progress       NUMERIC(5,2) NOT NULL,
  daily_site_photo_url         TEXT NOT NULL,            -- Storage path (daily-progress-photos/{uuid}.ext)
  original_photo_filename      VARCHAR,                  -- Original filename for UI display only
  remarks_after_site_visit     TEXT,                     -- Optional JE remarks

  -- Authority remark fields (post-creation, written by ZO/HO/Admin only)
  -- Note: approved_user_id, approval_date, and remarks_approved_authority must always be updated together. Never allow partial population.
  remarks_approved_authority   TEXT,
  approved_user_id             VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  approval_date                TIMESTAMPTZ,

  -- Integrity: physical progress must be between 0 and 100
  CONSTRAINT chk_physical_work_progress
    CHECK (physical_work_progress >= 0 AND physical_work_progress <= 100),

  -- Integrity: either all authority fields are NULL or all are NOT NULL
  CONSTRAINT chk_authority_remarks_consistency
    CHECK (
      (approved_user_id IS NULL AND approval_date IS NULL AND remarks_approved_authority IS NULL)
      OR
      (approved_user_id IS NOT NULL AND approval_date IS NOT NULL AND remarks_approved_authority IS NOT NULL)
    ),

  -- Integrity: enforce one daily progress report per work order per day
  CONSTRAINT uq_daily_progress_work_order_date UNIQUE (work_order_no, site_visit_date),

  -- Audit fields
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Indexes for performance
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_daily_progress_work_order
  ON daily_progress_reports(work_order_no);

CREATE INDEX IF NOT EXISTS idx_daily_progress_created_by
  ON daily_progress_reports(created_by);

CREATE INDEX IF NOT EXISTS idx_daily_progress_site_visit_date
  ON daily_progress_reports(site_visit_date DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: auto-update updated_at
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_daily_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_progress_updated_at ON daily_progress_reports;
CREATE TRIGGER trg_daily_progress_updated_at
BEFORE UPDATE ON daily_progress_reports
FOR EACH ROW EXECUTE FUNCTION set_daily_progress_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Trigger: block hard DELETE (reports are permanent, immutable records)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_daily_progress_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of daily progress reports is permanently prohibited. Records are immutable.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_daily_progress_hard_delete ON daily_progress_reports;
CREATE TRIGGER trg_prevent_daily_progress_hard_delete
BEFORE DELETE ON daily_progress_reports
FOR EACH ROW EXECUTE FUNCTION prevent_daily_progress_hard_delete();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Trigger: audit log on INSERT
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_daily_progress_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
  VALUES (
    NEW.created_by,
    'CREATE',
    'DailyProgress',
    NEW.report_id::VARCHAR,
    NULL,
    jsonb_build_object(
      'work_order_no',           NEW.work_order_no,
      'site_visit_date',         NEW.site_visit_date,
      'physical_work_progress',  NEW.physical_work_progress
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_daily_progress_insert ON daily_progress_reports;
CREATE TRIGGER trg_audit_daily_progress_insert
AFTER INSERT ON daily_progress_reports
FOR EACH ROW EXECUTE FUNCTION audit_daily_progress_insert();
