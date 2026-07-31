-- Migration 37: Executive Analytics Performance Index
BEGIN;

-- Speeds up monthly burn rate calculations
CREATE INDEX IF NOT EXISTS idx_requisitions_payment_date
    ON public.requisitions (payment_date);

COMMIT;
