#!/usr/bin/env bash
# Runs the scripted e2e call under several turn-taking settings and prints the
# per-turn latency for each. Usage: scripts/tune-latency.sh [workflow]
set -euo pipefail
cd "$(dirname "$0")/.."
WF=${1:-sales}

run() { # run "label" VAR=value ...
  local label=$1; shift
  echo "=================== $label ($*)"
  env "$@" docker compose up -d --force-recreate agent >/dev/null 2>&1
  for _ in $(seq 1 45); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' audiobots-agent-1)" = healthy ] && break
    sleep 2
  done
  docker compose run --rm --no-deps -v "$PWD/agent:/app" agent \
    python scripts/e2e_call.py "$WF" 2>&1 | grep -E '^\[(en|hi|ta)|voice-to-voice' || true
}

run "baseline"            STT_FLUSH_SIGNAL=true  VAD_MIN_SILENCE=0.3 ENDPOINTING_MIN_DELAY=0.4
run "no flush"            STT_FLUSH_SIGNAL=false VAD_MIN_SILENCE=0.3 ENDPOINTING_MIN_DELAY=0.4
run "tight endpointing"   STT_FLUSH_SIGNAL=true  VAD_MIN_SILENCE=0.2 ENDPOINTING_MIN_DELAY=0.2

# restore defaults
docker compose up -d --force-recreate agent >/dev/null 2>&1
