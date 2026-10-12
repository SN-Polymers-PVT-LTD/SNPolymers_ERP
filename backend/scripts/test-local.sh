#!/usr/bin/env bash
# =============================================================================
# test-local.sh — Run backend integration tests against a local Supabase instance
#
# Usage:
#   npm run test:local          # start supabase if needed, migrate, test
#   npm run test:payroll:local # separate payroll project/volumes on 55421/55422
#   bash scripts/test-local.sh --isolated <test files>
#
# Stacks are always left running. No automatic stop/reset or --no-backup cleanup.
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
export LOCAL_SUPABASE_TEST_PROFILE="${LOCAL_SUPABASE_TEST_PROFILE:-shared}"
# Full integration runs include payroll; keep them off the shared fixture stack.
if [ $# -eq 0 ]; then export LOCAL_SUPABASE_TEST_PROFILE=payroll; fi
if [ "${1:-}" = "--isolated" ]; then
  export LOCAL_SUPABASE_TEST_PROFILE=payroll
  shift
else
  # Explicit payroll file selections use the isolated stack even through test:local.
  for test_arg in "$@"; do
    case "$test_arg" in */payroll*.test.js|*tests/vitest|*tests/vitest/|*tests/vitest/regression|*tests/vitest/regression/) export LOCAL_SUPABASE_TEST_PROFILE=payroll ;; esac
  done
fi
STATUS_HELPER="$SCRIPT_DIR/lib/check-local-supabase-status.js"
PROJECT_ID=$(node "$STATUS_HELPER" --target projectId)
SUPABASE_URL=$(node "$STATUS_HELPER" --target apiUrl)
export SUPABASE_URL
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
SUPABASE_TEST_DB_URI=$(node "$STATUS_HELPER" --target dbUri)
export SUPABASE_TEST_DB_URI
# A caller's cloud/dev override must never redirect this local runner.
export USE_DEV_DB=false
export IDBP_FILTER_TEST_DATA="false"
export TELEGRAM_MODE="disabled"

# ─── Load JWT_SECRET from .env (we still need this for token signing) ─────────
ENV_FILE="$BACKEND_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  JWT_SECRET_VALUE=$(awk '/^JWT_SECRET=/ {sub(/^JWT_SECRET=/, ""); print; exit}' "$ENV_FILE")
  if [ -n "$JWT_SECRET_VALUE" ]; then
    export JWT_SECRET="$JWT_SECRET_VALUE"
  fi
fi

# Use an argument array so paths/CLI arguments are never reparsed by the shell.
if [ -x "$BACKEND_DIR/node_modules/.bin/supabase" ]; then
  SUPABASE_CMD=("$BACKEND_DIR/node_modules/.bin/supabase")
elif command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD=(supabase)
else
  echo "Supabase CLI is required. Install backend dependencies first." >&2
  exit 1
fi
SUPABASE_WORKDIR="$PROJECT_ROOT"
if [ "$LOCAL_SUPABASE_TEST_PROFILE" = payroll ]; then
  SUPABASE_WORKDIR="$BACKEND_DIR/tests/local-supabase"
fi

# Serialize local test runs against the selected project. The lock protects tests
# and migrations, not just startup. Distinct profiles have distinct locks.
exec {TEST_LOCK_FD}>"${TMPDIR:-/tmp}/${PROJECT_ID}.test-local.lock"
if ! flock -n "$TEST_LOCK_FD"; then
  echo "Another local test run owns $PROJECT_ID. Wait for it to finish." >&2
  exit 1
fi
STATUS_FILE=$(mktemp)
STATUS_ERROR=$(mktemp)
trap 'rm -f "$STATUS_FILE" "$STATUS_ERROR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cli() { "${SUPABASE_CMD[@]}" --workdir "$SUPABASE_WORKDIR" "$@"; }

printf '\n▶  Checking local Supabase status (%s)...\n' "$PROJECT_ID"
if cli status --output json >"$STATUS_FILE" 2>"$STATUS_ERROR"; then
  # A successful command with malformed/mismatched output is an error, not
  # evidence that we own or should start a database.
  node "$STATUS_HELPER" "$STATUS_FILE"
  echo "   Already running — reusing it without lifecycle cleanup."
else
  # CLI errors can mean a stopped DB OR a Docker/config/permission problem.
  # Independently check Docker before attempting to start/resume anything.
  if ! RUNNING_DB=$(docker ps --filter "name=^/supabase_db_${PROJECT_ID}$" --format '{{.Names}}'); then
    echo "Cannot inspect Docker. No stack was started or stopped." >&2
    exit 1
  fi
  if [ -n "$RUNNING_DB" ]; then
    echo "Database is running but CLI status failed. Refusing to start or migrate." >&2
    exit 1
  fi
  echo "   Starting/resuming the selected local stack; its data will be preserved."
  cli start
  cli status --output json >"$STATUS_FILE" 2>"$STATUS_ERROR"
  node "$STATUS_HELPER" "$STATUS_FILE"
fi

printf '\n▶  Applying pending migrations...\n'
cd "$BACKEND_DIR"
node scripts/apply-migrations.js

printf '\n▶  Running integration tests...\n'
TEST_EXIT_CODE=0
if [ $# -eq 0 ]; then
  npm run test:integration || TEST_EXIT_CODE=$?
else
  node_modules/.bin/vitest run "$@" || TEST_EXIT_CODE=$?
fi

# Never infer ownership from CLI output or clean up a pre-existing instance.
# Leaving even newly started stacks running also avoids concurrent-start races
# and preserves fixtures on test failure, migration failure, or interruption.
printf '\nLocal Supabase %s is left running; no data cleanup was performed.\n' "$PROJECT_ID"
if [ "$TEST_EXIT_CODE" -eq 0 ]; then
  echo "✅  All tests passed."
else
  echo "❌  Tests failed (exit code $TEST_EXIT_CODE)."
fi
exit "$TEST_EXIT_CODE"
