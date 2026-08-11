#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"

export SUPABASE_TEST_DB_URI="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# Helper function for supabase CLI execution
if [ -x "$BACKEND_DIR/node_modules/.bin/supabase" ]; then
  SUPABASE_CMD="$BACKEND_DIR/node_modules/.bin/supabase"
elif command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD="supabase"
else
  SUPABASE_CMD="npx -y supabase"
fi

cd "$PROJECT_ROOT"
$SUPABASE_CMD start

cd "$BACKEND_DIR"
node scripts/apply-migrations.js
npm run generate:manifests

cd "$PROJECT_ROOT"
$SUPABASE_CMD stop --no-backup
