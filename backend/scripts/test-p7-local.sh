#!/usr/bin/env bash
# =============================================================================
# test-p7-local.sh — Run milestone P7 tests against local Supabase
# =============================================================================

set -euo pipefail

# Local Supabase static credentials (safe: localhost only, public)
export SUPABASE_URL="http://127.0.0.1:54321"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
export SUPABASE_TEST_DB_URI="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export IDBP_FILTER_TEST_DATA="false"
export TELEGRAM_MODE="disabled"

# Load JWT_SECRET from .env for token signing
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$BACKEND_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  JWT_SECRET_VALUE=$(grep -E '^JWT_SECRET=' "$ENV_FILE" | head -1 | cut -d '=' -f2-)
  if [ -n "$JWT_SECRET_VALUE" ]; then
    export JWT_SECRET="$JWT_SECRET_VALUE"
  fi
fi

if [ $# -gt 0 ]; then
  case "$1" in
    db)
      echo "▶ Running milestone P7 DB tests against local Supabase..."
      node "$BACKEND_DIR/tests/milestones/test_milestone_p7_db.js"
      ;;
    api)
      echo "▶ Running milestone P7 API tests against local Supabase..."
      node "$BACKEND_DIR/tests/milestones/test_milestone_p7_api.js"
      ;;
    uat)
      echo "▶ Running milestone P7 UAT tests against local Supabase..."
      node "$BACKEND_DIR/tests/milestones/test_milestone_p7_uat.js"
      ;;
    *)
      echo "Unknown test component: $1. Must be db, api, or uat."
      exit 1
      ;;
  esac
else
  echo "▶ Running all milestone P7 tests against local Supabase..."
  node "$BACKEND_DIR/tests/milestones/test_milestone_p7_db.js"
  node "$BACKEND_DIR/tests/milestones/test_milestone_p7_api.js"
  node "$BACKEND_DIR/tests/milestones/test_milestone_p7_uat.js"
fi
