#!/usr/bin/env bash
# One industrial PC on the local Docker, laid out like its Kubernetes pod: every container shares one network
# namespace (so one CAN bus) and one in-memory volume (the machine). For trying the image before it ships.
#
#   bash edge/tools/local-pod.sh up EX1 [mqtt://host:1883]
#   bash edge/tools/local-pod.sh down EX1
set -euo pipefail
cmd="${1:-up}"
M="${2:-EX1}"
URL="${3:-mqtt://gw-local-broker:1883}"
m="$(echo "$M" | tr 'A-Z' 'a-z')"
NET=gw-edge-local
case "$M" in
  EX1) ROLES="engine telematics safety hydraulics swing controller gateway" ;;
  TC1) ROLES="engine telematics safety slew hoist lmi controller gateway" ;;
  HT1) ROLES="engine telematics safety transmission payload controller gateway" ;;
  DZ1) ROLES="engine telematics safety transmission blade controller gateway" ;;
  *) echo "machine is EX1, TC1, HT1 or DZ1"; exit 2 ;;
esac
if [ "$cmd" = down ]; then
  for r in $ROLES pause; do docker rm -f "ipc-$m-$r" >/dev/null 2>&1 || true; done
  docker volume rm "ipc-$m-plant" >/dev/null 2>&1 || true
  exit 0
fi
docker network inspect $NET >/dev/null 2>&1 || docker network create $NET >/dev/null
docker volume create "ipc-$m-plant" >/dev/null
# the pod's shared network namespace, holding the canbus sidecar
docker run -d --name "ipc-$m-pause" --network $NET -e GW_NODE="ipc-$m" groundwork-ipc:local python -m canbus >/dev/null
sleep 1
for r in $ROLES; do
  docker run -d --name "ipc-$m-$r" --network "container:ipc-$m-pause" -v "ipc-$m-plant:/plant" \
    -e GW_MACHINE="$M" -e GW_ROLE="$r" -e GW_SITE="${GW_SITE:-northgate}" -e MQTT_URL="$URL" groundwork-ipc:local >/dev/null
done
echo "ipc-$m up: $ROLES"
