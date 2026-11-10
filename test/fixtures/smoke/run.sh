#!/usr/bin/env bash
# Live smoke against headless DSH + mock LLM. Usage: run.sh [model] [enabled]
#   run.sh rl2        → 429s retried by the plugin (first wait ≈5s), then success
#   run.sh daily      → 429 "daily limit": quota by the default rules, 1 request, no retry (#5)
#   run.sh fail       → 1 request + 5 retries, then the turn ends with RATE_LIMIT
# Note: dsh-llm-pi-ai does not map Retry-After into providerRetryAfterMs (0.2.2-rc.1).
#   run.sh rl2 false  → plugin off: DSH's own behaviour
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
port=${MOCK_PORT:-3999}
log=${MOCK_LOG:-$(mktemp -d)/requests.jsonl}
MOCK_PORT=$port MOCK_LOG=$log node "$here/mock-llm.mjs" & mock=$!
trap 'kill $mock' EXIT
sleep 0.5
ws=$(mktemp -d)
sed "s|@PLUGIN@|$root/index.js|" "$here/patch.yml" > "$ws.patch.yml"
cd "$ws"
MOCK_API_KEY=x MOCK_PORT=$port SMOKE_MODEL=${1:-rl2} SMOKE_ENABLED=${2:-true} \
  dsh --profile headless --patch "$ws.patch.yml" --json "say hi" || echo "[dsh exit $?]"
echo "--- mock requests: $(wc -l < "$log")"
