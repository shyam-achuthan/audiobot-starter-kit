#!/usr/bin/env bash
# Connects the bundled Chatwoot and Twenty (crm profile) to AudioBots.
#   make up-crm      start them
#   make crm-setup   run this: scripts Chatwoot fully, then explains the one manual Twenty step
set -euo pipefail
cd "$(dirname "$0")/.."

env_get() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
env_set() {
  local key=$1 val=$2 tmp; tmp=$(mktemp)
  if grep -q "^${key}=" .env; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" == "$key="* ]]; then printf '%s=%s\n' "$key" "$val"; else printf '%s\n' "$line"; fi
    done < .env > "$tmp"
  else
    cat .env > "$tmp"; printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
  cat "$tmp" > .env && rm -f "$tmp"
}
rand() { python3 -c "import secrets,string,sys; a=string.ascii_letters+string.digits; print(''.join(secrets.choice(a) for _ in range(int(sys.argv[1]))))" "$1"; }

running() { [[ -n "$(docker compose ps -q --status running "$1" 2>/dev/null)" ]]; }

./scripts/init-env.sh >/dev/null

# ------------------------------------------------------------------ Chatwoot
echo "==> Chatwoot"
if ! running chatwoot-web; then
  echo "  chatwoot-web is not running. Start the CRM apps first: make up-crm"; exit 1
fi
printf '  waiting for Chatwoot to answer'
for _ in $(seq 1 60); do
  docker compose exec -T chatwoot-web sh -c 'wget -qO- http://127.0.0.1:3000/api >/dev/null 2>&1' 2>/dev/null && break
  printf '.'; sleep 3
done; echo

email=$(env_get CHATWOOT_ADMIN_EMAIL); [[ -n "$email" ]] || email=$(env_get ADMIN_EMAIL)
[[ -n "$email" ]] || email=admin@example.com
pw=$(env_get CHATWOOT_ADMIN_PASSWORD)
[[ -n "$pw" ]] || pw="Cw$(rand 16)9!"   # Chatwoot needs upper, lower, digit and symbol
hook="http://api:4000/v1/integrations/chatwoot/webhook?token=$(env_get CHATWOOT_WEBHOOK_TOKEN)"

out=$(docker compose exec -T -e CW_EMAIL="$email" -e CW_PASSWORD="$pw" -e CW_WEBHOOK_URL="$hook" \
  chatwoot-web bundle exec rails runner - < scripts/chatwoot-bootstrap.rb 2>/dev/null | grep '^CW_RESULT=' || true)
if [[ -z "$out" ]]; then
  echo "  Chatwoot setup failed. See: docker compose logs --tail=50 chatwoot-web"; exit 1
fi
json=${out#CW_RESULT=}
val() { python3 -c "import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])" "$json" "$1"; }
env_set CHATWOOT_ACCOUNT_ID "$(val account_id)"
env_set CHATWOOT_INBOX_ID "$(val inbox_id)"
env_set CHATWOOT_API_TOKEN "$(val token)"
env_set CHATWOOT_ADMIN_EMAIL "$email"
if [[ "$(val user_created)" == "True" ]]; then env_set CHATWOOT_ADMIN_PASSWORD "$pw"; fi
echo "  ✓ account $(val account_id), inbox \"Voice calls\" ($(val inbox_id)), API token saved to .env"
echo "  ✓ Chatwoot sends ticket status changes back to AudioBots"
url=$(env_get CHATWOOT_PUBLIC_URL); url=${url:-http://localhost:3030}
echo "  Sign in at $url as $email (password: CHATWOOT_ADMIN_PASSWORD in .env)"

# ------------------------------------------------------------------ Twenty
echo
echo "==> Twenty CRM"
if [[ -n "$(env_get TWENTY_API_KEY)" ]]; then
  echo "  ✓ TWENTY_API_KEY is set"
else
  cat <<TXT
  Twenty has no supported way to script its first sign-up, so this step is manual (2 minutes):
    1. Open http://localhost:3020 and create your account and workspace.
    2. Settings -> Developers -> API Keys -> Create API key (role Admin, expiry Never).
    3. Copy the key and add it to .env:  TWENTY_API_KEY=...
    4. Run: make crm-setup   (or: docker compose up -d api)
TXT
fi

echo
echo "==> Restarting the API with the new settings"
docker compose up -d api >/dev/null 2>&1
echo "  ✓ done. Check Admin -> Integrations: both connectors should show Connected."
