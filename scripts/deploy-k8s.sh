#!/usr/bin/env bash
# Runs the bff inside a local minikube next to Abenix, then forwards one port for the browser.
# The browser channel is server to client, so it does not pay the port-forward request-body stall.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROFILE="${MINIKUBE_PROFILE:-minikube}"
KEY="${ABENIX_API_KEY:-$(grep -s '^ABENIX_API_KEY=' .env | cut -d= -f2- || true)}"
[ -n "$KEY" ] || { echo "No ABENIX_API_KEY. Run scripts/provision.py first."; exit 1; }

echo "[groundwork] building groundwork-bff:local into minikube profile $PROFILE"
eval "$(minikube -p "$PROFILE" docker-env)"
docker build -f bff/Dockerfile -t groundwork-bff:local .

echo "[groundwork] applying deploy/k8s/groundwork.yaml"
kubectl apply -f deploy/k8s/groundwork.yaml
kubectl -n groundwork create secret generic groundwork-abenix --from-literal=api-key="$KEY" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n groundwork rollout restart deploy/groundwork-bff
kubectl -n groundwork rollout status deploy/groundwork-bff --timeout=180s

echo "[groundwork] bff running in the cluster with a fixed 20 Hz step"
echo "[groundwork] forward it for the web:  kubectl -n groundwork port-forward svc/groundwork-bff 8710:8710"
