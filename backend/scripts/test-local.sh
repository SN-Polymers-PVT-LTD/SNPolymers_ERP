#!/usr/bin/env bash
# =============================================================================
# test-local.sh — Run backend integration tests against a local Supabase instance
#
# Usage:
#   npm run test:local          # start supabase if needed, migrate, test
#   npm run test:local -- --ui  # same but open vitest UI
#
# The local Supabase stack uses static well-known credentials (localhost only).
# JWT_SECRET is loaded from your .env file automatically.
# =============================================================================

set -euo pipefail

# Resolve directories relative to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"

# ─── Local Supabase static credentials (safe: localhost only, public) ────────
export SUPABASE_URL="http://127.0.0.1:54321"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
export SUPABASE_TEST_DB_URI="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export IDBP_FILTER_TEST_DATA="false"
export TELEGRAM_MODE="disabled"

# ─── Load JWT_SECRET from .env (we still need this for token signing) ─────────
ENV_FILE="$BACKEND_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  JWT_SECRET_VALUE=$(grep -E '^JWT_SECRET=' "$ENV_FILE" | head -1 | cut -d '=' -f2-)
  if [ -n "$JWT_SECRET_VALUE" ]; then
    export JWT_SECRET="$JWT_SECRET_VALUE"
  fi
fi

# Helper function for supabase CLI execution
if [ -x "$BACKEND_DIR/node_modules/.bin/supabase" ]; then
  SUPABASE_CMD="$BACKEND_DIR/node_modules/.bin/supabase"
elif command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD="supabase"
else
  SUPABASE_CMD="npx -y supabase"
fi

# ─── Start local Supabase if not already running ──────────────────────────────
echo ""
echo "▶  Checking local Supabase status..."
cd "$PROJECT_ROOT"

if $SUPABASE_CMD status 2>/dev/null | grep -q "API URL"; then
  echo "   Already running — skipping supabase start."
  SUPABASE_WAS_RUNNING=true
else
  echo "   Starting local Supabase (this takes ~60s the first time)..."
  $SUPABASE_CMD start
  SUPABASE_WAS_RUNNING=false
fi

# ─── Apply any pending migrations ─────────────────────────────────────────────
echo ""
echo "▶  Applying pending migrations..."
cd "$BACKEND_DIR"
node scripts/apply-migrations.js

# ─── Run tests ────────────────────────────────────────────────────────────────
echo ""
echo "▶  Running integration tests..."
# Forward any extra args (e.g. --ui, a specific file) to vitest
if [ $# -eq 0 ]; then
  npm run test:integration
else
  node_modules/.bin/vitest run "$@"
fi
TEST_EXIT_CODE=$?

# ─── Optionally stop Supabase ─────────────────────────────────────────────────
# We only stop it if we were the ones who started it.
# If it was already running, leave it running (you may have the app open).
if [ "$SUPABASE_WAS_RUNNING" = "false" ]; then
  echo ""
  echo "▶  Stopping local Supabase..."
  cd "$PROJECT_ROOT"
  $SUPABASE_CMD stop --no-backup
fi

echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅  All tests passed."
else
  echo "❌  Tests failed (exit code $TEST_EXIT_CODE)."
fi

exit $TEST_EXIT_CODE
