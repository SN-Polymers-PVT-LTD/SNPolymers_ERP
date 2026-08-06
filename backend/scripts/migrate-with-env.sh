#!/usr/bin/env bash
# Load a gitignored env file and run a backend migration script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-}"

if [ -z "$ENV_FILE" ]; then
  echo "Usage: bash scripts/migrate-with-env.sh .env.dev-db [script.js] [-- args...]"
  exit 1
fi

shift || true

NODE_SCRIPT="apply-migrations.js"
if [ $# -gt 0 ] && [[ "$1" == *.js ]]; then
  NODE_SCRIPT="$1"
  shift
fi

if [ ! -f "$BACKEND_DIR/$ENV_FILE" ]; then
  echo "Env file not found: $BACKEND_DIR/$ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$BACKEND_DIR/$ENV_FILE"
set +a

cd "$BACKEND_DIR"
node "scripts/$NODE_SCRIPT" "$@"
