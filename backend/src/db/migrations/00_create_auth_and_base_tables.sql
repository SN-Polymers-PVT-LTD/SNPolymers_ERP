-- Migration 00: Base Auth Tables (authorised_users, sessions, otp_requests)

-- 1. authorised_users table
CREATE TABLE IF NOT EXISTS public.authorised_users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile_number     VARCHAR UNIQUE NOT NULL,
  display_name      VARCHAR NOT NULL,
  role              VARCHAR NOT NULL DEFAULT 'je',
  permissions       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  telegram_chat_id  VARCHAR,
  daily_streak      INTEGER DEFAULT 0,
  last_report_date  DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT authorised_users_role_check CHECK (role IN ('je', 'zo', 'ho', 'admin'))
);

-- 2. sessions table
CREATE TABLE IF NOT EXISTS public.sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES public.authorised_users(id) ON DELETE CASCADE,
  jwt_jti           VARCHAR UNIQUE NOT NULL,
  ip_address        INET,
  user_agent        TEXT,
  module            VARCHAR DEFAULT 'office',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  login_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_at         TIMESTAMPTZ,
  duration_seconds  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_login ON public.sessions(user_id, login_at DESC);

-- 3. otp_requests table
CREATE TABLE IF NOT EXISTS public.otp_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile_number VARCHAR NOT NULL,
  otp_hash      VARCHAR NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  is_used       BOOLEAN NOT NULL DEFAULT false,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed initial admin user if not exists
INSERT INTO public.authorised_users (mobile_number, display_name, role, is_active)
VALUES ('+918276071523', 'System Admin', 'admin', true)
ON CONFLICT (mobile_number) DO NOTHING;
