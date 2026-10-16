#!/usr/bin/env bash
# Build the pinned VAmPI baseline and run two instances, then seed the canonical BOLA state:
#   :5002 vulnerable=1 (bug on)   -> red-team target
#   :5001 vulnerable=0 (bug off)  -> reference "fixed" build
# Pinned via infra/fixture/vampi/Dockerfile (commit f16052d...). Requires docker.
set -euo pipefail
cd "$(dirname "$0")/.."

TTL="${TOKEN_TTL:-300}"
command -v docker >/dev/null || { echo "docker not found; run where Daytona/docker is available" >&2; exit 1; }

docker build -f infra/fixture/vampi/Dockerfile -t restorelab-vampi:pinned infra/fixture/vampi
echo "baseline image id: $(docker inspect --format '{{.Id}}' restorelab-vampi:pinned)"

docker rm -f vampi-insecure vampi-secure >/dev/null 2>&1 || true
docker run -d --name vampi-insecure -e vulnerable=1 -e tokentimetolive="$TTL" -p 5002:5000 restorelab-vampi:pinned
docker run -d --name vampi-secure   -e vulnerable=0 -e tokentimetolive="$TTL" -p 5001:5000 restorelab-vampi:pinned

for p in 5002 5001; do
  for _ in $(seq 30); do curl -fsS "http://127.0.0.1:$p/" >/dev/null 2>&1 && break; sleep 0.5; done
done
scripts/seed-vampi.sh http://127.0.0.1:5002
scripts/seed-vampi.sh http://127.0.0.1:5001

echo "vulnerable VAmPI -> http://127.0.0.1:5002  (red-team target)"
echo "fixed VAmPI      -> http://127.0.0.1:5001  (reference recovery)"
echo "reset between runs: scripts/seed-vampi.sh http://127.0.0.1:5002"
