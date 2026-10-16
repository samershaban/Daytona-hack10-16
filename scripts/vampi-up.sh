#!/usr/bin/env bash
# Run VAmPI as a stretch/real-world BOLA target. Two instances:
#   :5002 vulnerable=1 (bug on)   -> red-team proves BOLA here
#   :5001 vulnerable=0 (bug off)  -> the reference "fixed" build (deterministic reference recovery)
# VAmPI is OWASP-catalogued and team-run locally/in Daytona. Requires docker.
set -euo pipefail

IMAGE="${VAMPI_IMAGE:-erev0s/vampi:latest}"
TTL="${TOKEN_TTL:-300}"

command -v docker >/dev/null || { echo "docker not found; run this where Daytona/docker is available" >&2; exit 1; }

docker rm -f vampi-insecure vampi-secure >/dev/null 2>&1 || true
docker run -d --name vampi-insecure -e vulnerable=1 -e tokentimetolive="$TTL" -p 5002:5000 "$IMAGE"
docker run -d --name vampi-secure   -e vulnerable=0 -e tokentimetolive="$TTL" -p 5001:5000 "$IMAGE"

echo "vulnerable VAmPI -> http://127.0.0.1:5002  (red-team target)"
echo "fixed VAmPI      -> http://127.0.0.1:5001  (reference recovery)"
echo "reset between runs: scripts/reset-vampi.sh http://127.0.0.1:5002  (GET /createdb)"
