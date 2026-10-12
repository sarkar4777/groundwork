#!/usr/bin/env bash
# Runs the bff inside a local minikube next to Abenix, and owns the one port-forward the web needs.
# The browser channel is server to client, so it does not pay the port-forward request-body stall.
#
#   bash scripts/deploy-k8s.sh            build, apply, roll out (same as deploy)
#   bash scripts/deploy-k8s.sh forward    start the 8710 forward in the background, restarted if it drops, wait until /health answers
#   bash scripts/deploy-k8s.sh stop       end the forward this script started
#   bash scripts/deploy-k8s.sh status     the deployment, the forward and the bff health
#
# The four simulated industrial PCs, namespace groundwork-edge:
#   bash scripts/deploy-k8s.sh edge                build groundwork-ipc:local, apply, roll out
#   bash scripts/deploy-k8s.sh edge-status         pods, containers and what each PC reports
#   bash scripts/deploy-k8s.sh edge-forward        the in-cluster MQTT broker on localhost:18830, supervised
#   bash scripts/deploy-k8s.sh edge-check [s] [n] [m]  a test pod listens s seconds, holds and faults node n, makes m's bus noisy
#   bash scripts/deploy-k8s.sh edge-candump EX1 [lines]   the PC's candump -L log
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROFILE="${MINIKUBE_PROFILE:-minikube}"
# pinned to the profile so a second cluster on the machine is never touched
K="kubectl --context $PROFILE"
PORT="${GW_BFF_PORT:-8710}"
RUN="$ROOT/.run"
PIDFILE="$RUN/bff-forward.pid"
CHILDFILE="$RUN/bff-forward-child.pid"
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
  # links from the ground station into Abenix, 3000 unless .env moves it
  local web="${ABENIX_WEB_URL:-$(grep -s '^ABENIX_WEB_URL=' .env | cut -d= -f2- || true)}"
  $K -n groundwork set env deploy/groundwork-bff ABENIX_WEB_URL="${web:-http://localhost:3000}" >/dev/null
  # northgate is the painted site, nh108 the real drone orthophoto (fetch it first, see docs/real-imagery.md)
  local site="${GW_SITE:-$(grep -s '^GW_SITE=' .env | cut -d= -f2- || true)}"
  $K -n groundwork set env deploy/groundwork-bff GW_SITE="${site:-northgate}" >/dev/null
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
    : >"$LOG"
    # supervised, a bare port-forward exits on a pod restart or a dropped connection and stays down
    nohup bash "$0" supervise >/dev/null 2>&1 &
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

supervise() {
  trap '[ -f "$CHILDFILE" ] && kill "$(cat "$CHILDFILE")" 2>/dev/null; exit 0' TERM INT
  while true; do
    $K -n groundwork port-forward svc/groundwork-bff "$PORT:8710" >>"$LOG" 2>&1 &
    echo $! >"$CHILDFILE"
    wait $! || true
    say "forward exited at $(date +%T), restarting" >>"$LOG"
    sleep 1
  done
}

stop() {
  if pid="$(forward_pid)"; then
    kill "$pid" 2>/dev/null || true
    say "forward stopped, pid $pid"
  else
    say "no forward started by this script is running"
  fi
  [ -f "$CHILDFILE" ] && kill "$(cat "$CHILDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE" "$CHILDFILE"
}

status() {
  $K -n groundwork get deploy,pods,svc 2>/dev/null || say "no groundwork namespace on $PROFILE"
  if pid="$(forward_pid)"; then say "forward running, pid $pid"; else say "no forward running"; fi
  curl -fsS -m 3 "http://localhost:$PORT/health" 2>/dev/null | head -c 400 || say "bff not answering on $PORT"
  echo
}

EDGE_PORT="${GW_BROKER_PORT:-18830}"
EPID="$RUN/broker-forward.pid"
ELOG="$RUN/broker-forward.log"

edge() {
  say "building groundwork-ipc:local into minikube profile $PROFILE"
  eval "$(minikube -p "$PROFILE" docker-env)"
  docker build -f edge/Dockerfile -t groundwork-ipc:local .
  say "applying deploy/k8s/groundwork-edge.yaml"
  $K apply -f deploy/k8s/groundwork-edge.yaml
  # the PCs drive the same layout as the twin, northgate or nh108, from GW_SITE or .env
  local site="${GW_SITE:-$(grep -s '^GW_SITE=' .env | cut -d= -f2- || true)}"
  $K -n groundwork-edge patch configmap groundwork-edge --type merge -p "{\"data\":{\"site\":\"${site:-northgate}\"}}" >/dev/null
  say "PCs on the ${site:-northgate} layout"
  for m in ex1 tc1 ht1 dz1; do $K -n groundwork-edge rollout restart deploy/ipc-$m >/dev/null; done
  for m in ex1 tc1 ht1 dz1; do $K -n groundwork-edge rollout status deploy/ipc-$m --timeout=180s; done
  say "four industrial PCs publishing Sparkplug B to abenix-mosquitto, check with: bash scripts/deploy-k8s.sh edge-check"
}

edge_status() {
  $K -n groundwork-edge get deploy,pods -o wide 2>/dev/null || say "no groundwork-edge namespace on $PROFILE"
  for m in ex1 tc1 ht1 dz1; do
    printf '%s: ' "ipc-$m"
    $K -n groundwork-edge get pod -l machine="$(echo $m | tr a-z A-Z)" -o jsonpath='{range .items[*].status.containerStatuses[*]}{.name}={.ready} {end}' 2>/dev/null
    echo
  done
}

edge_forward() {
  if [ -f "$EPID" ] && kill -0 "$(cat "$EPID")" 2>/dev/null; then
    say "broker forward already running, pid $(cat "$EPID"), mqtt://localhost:$EDGE_PORT"
    return 0
  fi
  mkdir -p "$RUN"
  : >"$ELOG"
  nohup bash "$0" edge-supervise >/dev/null 2>&1 &
  echo $! >"$EPID"
  say "broker forward started, pid $(cat "$EPID"), mqtt://localhost:$EDGE_PORT, log $ELOG"
}

edge_supervise() {
  trap 'exit 0' TERM INT
  while true; do
    $K -n abenix port-forward svc/abenix-mosquitto "$EDGE_PORT:1883" >>"$ELOG" 2>&1 || true
    sleep 1
  done
}

edge_check() {
  local secs="${1:-20}" node="${2:-ipc-ex1}" noisy="${3:-ipc-tc1}"
  $K -n groundwork-edge delete pod gw-check --ignore-not-found >/dev/null
  $K -n groundwork-edge run gw-check --rm -i --restart=Never --image groundwork-ipc:local --image-pull-policy Never     --overrides='{"spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":10001}}}'     -- python -m tools.check --seconds "$secs" --hold "$node" --fault "$node" --noise "$noisy" --print-json
}

edge_candump() {
  local m="${1:-EX1}" n="${2:-200}"
  local pod
  pod="$($K -n groundwork-edge get pod -l machine="$m" -o jsonpath='{.items[0].metadata.name}')"
  $K -n groundwork-edge exec "$pod" -c canbus -- sh -c "tail -n $n /var/log/candump/ipc-$(echo "$m" | tr A-Z a-z).log"
}

case "${1:-deploy}" in
  edge) edge ;;
  edge-status) edge_status ;;
  edge-forward) edge_forward ;;
  edge-supervise) edge_supervise ;;
  edge-check) shift; edge_check "$@" ;;
  edge-candump) shift; edge_candump "$@" ;;
  deploy) deploy ;;
  forward) forward ;;
  supervise) supervise ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 [deploy|forward|stop|status|edge|edge-status|edge-forward|edge-check|edge-candump]"; exit 2 ;;
esac
