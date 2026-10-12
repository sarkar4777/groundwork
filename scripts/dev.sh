#!/usr/bin/env bash
# Starts the bff on 8710 and the web on 5710. Ctrl+C stops both.
#   GW_BFF_PORT=8711 GW_NO_WEB=1 GW_SITE=nh108 bash scripts/dev.sh   a second bff on the real-site layout, no web
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -x .venv/bin/python ]; then PY=.venv/bin/python
elif [ -x .venv/Scripts/python.exe ]; then PY=.venv/Scripts/python.exe
else PY=python3; fi

ABENIX_URL="${ABENIX_URL:-$(grep -s '^ABENIX_URL=' .env | cut -d= -f2- || true)}"
ABENIX_URL="${ABENIX_URL:-http://localhost:8000}"

PORT="${GW_BFF_PORT:-8710}"

say() { printf '\033[1;36m[groundwork]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[groundwork]\033[0m %s\n' "$*"; exit 1; }

"$PY" -c "import fastapi, uvicorn, httpx, yaml" 2>/dev/null || fail "Python packages missing. Run: python3 -m venv .venv && .venv/bin/pip install -r bff/requirements.txt"
grep -qs '^ABENIX_API_KEY=..*' .env || fail "No ABENIX_API_KEY in .env. Run: $PY scripts/provision.py"
curl -fsS -m 5 "$ABENIX_URL/api/health" >/dev/null || fail "Abenix is not answering at $ABENIX_URL. Start it first, the twin runs inside it."
[ -d web/node_modules ] || (say "installing web packages" && (cd web && npm install --no-audit --no-fund))

pids=()
cleanup() { say "stopping"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

say "Abenix   $ABENIX_URL"
say "bff      http://localhost:$PORT  (websocket ws://localhost:$PORT/ws, health /health, site ${GW_SITE:-northgate})"
(cd bff && exec "../$PY" -m uvicorn gwbff.app:app --host 0.0.0.0 --port "$PORT" --log-level warning) &
pids+=($!)

if [ "${GW_NO_WEB:-0}" != "1" ]; then
  say "web      http://localhost:5710"
  (cd web && exec npm run dev --silent) &
  pids+=($!)
fi

for i in $(seq 1 60); do
  if curl -fsS -m 2 "http://localhost:$PORT/health" 2>/dev/null | grep -q '"ok":true'; then
    say "site twin running in Abenix, open http://localhost:5710"
    break
  fi
  sleep 1
done

wait
