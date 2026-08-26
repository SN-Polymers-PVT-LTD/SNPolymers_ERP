-- ===========================================================================
-- Migration 033: Continuous Face Verification - Schema & Session State
-- DB: PostgreSQL (Supabase)
--
-- 1. Create table public.face_descriptors to store 128-d biometric embeddings
--    generated via face-api.js / TensorFlow.js on the client.
--    - 128-d array constraint: COALESCE(array_ndims(descriptor) = 1 AND array_length(descriptor, 1) = 128, false)
--    - Unique constraint on user_id (1:1 with authorised_users)
--    - ON DELETE CASCADE to ensure zero orphaned biometric data when user is deleted
--    - Row Level Security (RLS) enabled with deny-all default (service_role bypass)
--    - updated_at trigger for automated timestamp tracking
-- 2. Alter public.sessions to track face verification telemetry & lock state:
--    - last_face_verified_at TIMESTAMPTZ (nullable, initial state null)
--    - face_locked BOOLEAN NOT NULL DEFAULT false
--    - face_verification_misses SMALLINT NOT NULL DEFAULT 0 (CHECK >= 0)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. public.face_descriptors
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.face_descriptors (
    id           UUID                     DEFAULT gen_random_uuid() NOT NULL,
    user_id      UUID                     NOT NULL,
    descriptor   double precision[]       NOT NULL,
    enrolled_at  TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    consented_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT face_descriptors_pkey PRIMARY KEY (id),
    CONSTRAINT uq_face_descriptors_user_id UNIQUE (user_id),
    CONSTRAINT fk_face_descriptors_user_id
        FOREIGN KEY (user_id) REFERENCES public.authorised_users(id) ON DELETE CASCADE,
    CONSTRAINT chk_face_descriptor_128d
        CHECK (COALESCE(array_ndims(descriptor) = 1 AND array_length(descriptor, 1) = 128, false))
);

-- Ensure constraint is up-to-date even if table was created in a prior step
DO $$
BEGIN
    ALTER TABLE public.face_descriptors
        DROP CONSTRAINT IF EXISTS chk_face_descriptor_128d;
    ALTER TABLE public.face_descriptors
        ADD CONSTRAINT chk_face_descriptor_128d
        CHECK (COALESCE(array_ndims(descriptor) = 1 AND array_length(descriptor, 1) = 128, false));
END $$;

-- Row-Level Security: deny-all default for anon/authenticated roles;
-- backend service_role key bypasses RLS.
ALTER TABLE public.face_descriptors ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.face_descriptors TO anon;
GRANT ALL ON TABLE public.face_descriptors TO authenticated;
GRANT ALL ON TABLE public.face_descriptors TO service_role;

-- updated_at trigger function & trigger
CREATE OR REPLACE FUNCTION public.set_face_descriptor_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_face_descriptor_updated_at ON public.face_descriptors;
CREATE TRIGGER trg_face_descriptor_updated_at
    BEFORE UPDATE ON public.face_descriptors
    FOR EACH ROW EXECUTE FUNCTION public.set_face_descriptor_updated_at();

-- ---------------------------------------------------------------------------
-- 2. public.sessions additions
-- ---------------------------------------------------------------------------

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS last_face_verified_at    TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS face_locked              BOOLEAN  NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS face_verification_misses SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_sessions_face_misses_non_negative'
    ) THEN
        ALTER TABLE public.sessions
            ADD CONSTRAINT chk_sessions_face_misses_non_negative
            CHECK (face_verification_misses >= 0);
    END IF;
END $$;
