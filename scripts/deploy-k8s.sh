#!/usr/bin/env bash
# Runs the bff inside a local minikube next to Abenix, and owns the one port-forward the web needs.
# The browser channel is server to client, so it does not pay the port-forward request-body stall.
#
#   bash scripts/deploy-k8s.sh            build, apply, roll out (same as deploy)
#   bash scripts/deploy-k8s.sh forward    start the 8710 forward in the background, wait until /health answers
#   bash scripts/deploy-k8s.sh stop       end the forward this script started
#   bash scripts/deploy-k8s.sh status     the deployment, the forward and the bff health
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROFILE="${MINIKUBE_PROFILE:-minikube}"
# pinned to the profile so a second cluster on the machine is never touched
K="kubectl --context $PROFILE"
PORT="${GW_BFF_PORT:-8710}"
RUN="$ROOT/.run"
PIDFILE="$RUN/bff-forward.pid"
LOG="$RUN/bff-forward.log"

say() { printf '[groundwork] %s\n' "$*"; }

forward_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE")"
  kill -0 "$pid" 2>/dev/null && echo "$pid"
}

healthy() { curl -fsS -m 3 "http://localhost:$PORT/health" 2>/dev/null | grep -q '"ok":true'; }

deploy() {
  local key="${ABENIX_API_KEY:-$(grep -s '^ABENIX_API_KEY=' .env | cut -d= -f2- || true)}"
  [ -n "$key" ] || { say "No ABENIX_API_KEY. Run scripts/provision.py first."; exit 1; }
  say "building groundwork-bff:local into minikube profile $PROFILE"
  eval "$(minikube -p "$PROFILE" docker-env)"
  docker build -f bff/Dockerfile -t groundwork-bff:local .
  say "applying deploy/k8s/groundwork.yaml"
  $K apply -f deploy/k8s/groundwork.yaml
  $K -n groundwork create secret generic groundwork-abenix --from-literal=api-key="$key" --dry-run=client -o yaml | $K apply -f -
  $K -n groundwork rollout restart deploy/groundwork-bff
  $K -n groundwork rollout status deploy/groundwork-bff --timeout=180s
  say "bff running in the cluster with a fixed 20 Hz step"
  say "next: bash scripts/deploy-k8s.sh forward"
}

forward() {
  if pid="$(forward_pid)"; then
    say "forward already running, pid $pid"
  else
    if curl -fsS -m 2 "http://localhost:$PORT/health" >/dev/null 2>&1; then
      say "something else already answers on port $PORT, stop it first (a laptop bff from dev.sh?)"
      exit 1
    fi
    mkdir -p "$RUN"
    nohup $K -n groundwork port-forward svc/groundwork-bff "$PORT:8710" >"$LOG" 2>&1 &
    echo $! >"$PIDFILE"
    say "forward started, pid $(cat "$PIDFILE"), log $LOG"
  fi
  for _ in $(seq 1 30); do
    if healthy; then
      say "bff healthy on http://localhost:$PORT, start the web with: (cd web && npm run dev)"
      return 0
    fi
    sleep 1
  done
  say "the forward is up but /health did not answer ok in 30 s, see $LOG and: bash scripts/deploy-k8s.sh status"
  exit 1
}

stop() {
  if pid="$(forward_pid)"; then
    kill "$pid" 2>/dev/null || true
    say "forward stopped, pid $pid"
  else
    say "no forward started by this script is running"
  fi
  rm -f "$PIDFILE"
}

status() {
  $K -n groundwork get deploy,pods,svc 2>/dev/null || say "no groundwork namespace on $PROFILE"
  if pid="$(forward_pid)"; then say "forward running, pid $pid"; else say "no forward running"; fi
  curl -fsS -m 3 "http://localhost:$PORT/health" 2>/dev/null | head -c 400 || say "bff not answering on $PORT"
  echo
}

case "${1:-deploy}" in
  deploy) deploy ;;
  forward) forward ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 [deploy|forward|stop|status]"; exit 2 ;;
esac
