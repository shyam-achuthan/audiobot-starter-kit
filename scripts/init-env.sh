#!/usr/bin/env bash
# Creates .env from .env.example (if missing), fills generated secrets,
# and (re)detects LIVEKIT_NODE_IP. Safe to re-run: existing values are kept.
set -euo pipefail
cd "$(dirname "$0")/.."

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

set_var() { # set_var KEY VALUE  (portable in-place edit for macOS + Linux)
  local key=$1 val=$2
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" .env && rm -f .env.bak
  else
    echo "${key}=${val}" >> .env
  fi
}

fill() { # fill KEY VALUE — only replaces __GENERATE__ placeholders
  if grep -q "^$1=__GENERATE__" .env; then set_var "$1" "$2"; fi
}

# Upgrades: add settings that are new in .env.example to an existing .env.
added=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]] || continue
  key=${BASH_REMATCH[1]}
  if ! grep -q "^${key}=" .env; then
    printf '%s\n' "$line" >> .env
    added+=("$key")
  fi
done < .env.example
if (( ${#added[@]} )); then echo "Added new settings to .env: ${added[*]}"; fi

fill LIVEKIT_API_KEY "API$(rand 12)"
fill LIVEKIT_API_SECRET "$(rand 48)"
fill POSTGRES_PASSWORD "$(rand 24)"
fill S3_ACCESS_KEY "$(rand 20)"
fill S3_SECRET_KEY "$(rand 40)"
fill LITELLM_MASTER_KEY "sk-$(rand 32)"
fill AGENT_API_TOKEN "$(rand 40)"
fill CHATWOOT_WEBHOOK_TOKEN "$(rand 32)"
fill TWENTY_APP_SECRET "$(rand 48)"
fill CHATWOOT_SECRET_KEY_BASE "$(rand 96)"

# Detect the LAN IP of the default interface (macOS, then Linux).
IP=""
if command -v route >/dev/null 2>&1 && route -n get default >/dev/null 2>&1; then
  IFACE=$(route -n get default | awk '/interface/{print $2}')
  IP=$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)
fi
if [[ -z "$IP" ]] && command -v hostname >/dev/null 2>&1; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
fi
if [[ -n "$IP" ]]; then
  set_var LIVEKIT_NODE_IP "$IP"
  echo "LIVEKIT_NODE_IP=$IP"
else
  echo "WARN: could not detect LAN IP; LIVEKIT_NODE_IP left as is" >&2
fi
