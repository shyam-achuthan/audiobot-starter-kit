#!/usr/bin/env bash
# AudioBots — one-command setup.
#
#   ./setup.sh                 interactive: checks, .env, keys, build, start, verify
#   ./setup.sh --yes           non-interactive (uses whatever is already in .env)
#   ./setup.sh --no-start      prepare .env only, don't build/start containers
#   ./setup.sh --help
#
# Safe to re-run: existing .env values and data volumes are kept.
set -euo pipefail
cd "$(dirname "$0")"

# ---------------------------------------------------------------- options
INTERACTIVE=1
START=1
for arg in "$@"; do
  case "$arg" in
    -y|--yes|--non-interactive) INTERACTIVE=0 ;;
    --no-start) START=0 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done
[[ -t 0 ]] || INTERACTIVE=0   # no TTY (CI, piped) -> never prompt

# ---------------------------------------------------------------- output helpers
if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'; else B= G= Y= R= D= N=; fi
step() { printf '\n%s==> %s%s\n' "$B" "$1" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
fail() { printf '  %s✗ %s%s\n' "$R" "$1" "$N" >&2; exit 1; }

# ---------------------------------------------------------------- .env helpers
env_get() { # env_get KEY -> value ('' if unset)
  [[ -f .env ]] || { echo ""; return; }
  local line; line=$(grep -E "^$1=" .env | tail -n1 || true)
  echo "${line#*=}"
}
env_set() { # env_set KEY VALUE — rewrites the line in place, keeps file owner/perms
  local key=$1 val=$2 tmp found=0 line
  tmp=$(mktemp)
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$key="* ]]; then printf '%s=%s\n' "$key" "$val"; found=1
    else printf '%s\n' "$line"; fi
  done < .env > "$tmp"
  [[ $found == 1 ]] || printf '%s=%s\n' "$key" "$val" >> "$tmp"
  cat "$tmp" > .env && rm -f "$tmp"
}
ask_secret() { # ask_secret KEY "description" "where to get it"
  local key=$1 desc=$2 url=$3 cur val
  cur=$(env_get "$key")
  if [[ -n "$cur" ]]; then ok "$key already set"; return; fi
  if [[ $INTERACTIVE == 0 ]]; then warn "$key is empty — $desc ($url)"; return; fi
  printf '  %s%s%s — %s\n  %sGet one at: %s%s\n' "$B" "$key" "$N" "$desc" "$D" "$url" "$N"
  read -r -s -p "  Paste value (input hidden, Enter to skip): " val; echo
  if [[ -n "$val" ]]; then env_set "$key" "$val"; ok "$key saved to .env"
  else warn "$key skipped — add it to .env later"; fi
}

# ---------------------------------------------------------------- 1. prerequisites
step "Checking prerequisites"
command -v docker >/dev/null 2>&1 || fail "Docker not found. Install Docker Desktop (macOS/Windows) or Docker Engine (Linux)."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 not found ('docker compose'). Update Docker."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker Desktop and re-run."
ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null), Compose $(docker compose version --short 2>/dev/null)"

mem_bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
mem_gb=$(( mem_bytes / 1024 / 1024 / 1024 ))
if (( mem_gb > 0 && mem_gb < 6 )); then warn "Docker has ${mem_gb} GB RAM; 6 GB+ recommended (Docker Desktop → Settings → Resources)."
else ok "Docker memory: ${mem_gb} GB"; fi

for tool in curl; do command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"; done
ok "curl available"

# Ports the stack publishes. Ports already held by this project's containers are fine.
ours=$(docker compose ps -q 2>/dev/null | wc -l | tr -d ' ')
busy=()
for p in 3000 4000 4100 5433 7880 7881 9000 9001; do
  if (lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || nc -z 127.0.0.1 "$p" >/dev/null 2>&1); then busy+=("$p"); fi
done
if (( ${#busy[@]} )) && [[ "$ours" == 0 ]]; then
  warn "Ports in use by something else: ${busy[*]}. Stop those services or change the ports in docker-compose.yml."
elif (( ${#busy[@]} )); then ok "Ports ${busy[*]} held by the running AudioBots stack"
else ok "Ports 3000 4000 4100 5433 7880 7881 9000 9001 are free"; fi

# ---------------------------------------------------------------- 2. .env
step "Preparing .env (secrets + network)"
./scripts/init-env.sh | sed 's/^/  /'
if [[ ! -w .env ]]; then
  fail ".env is not writable by $(whoami) (edited with sudo?). Fix with: sudo chown $(whoami) .env"
fi
chmod 600 .env 2>/dev/null || warn "Could not set .env permissions to 600"
ok ".env ready (owner-only permissions, gitignored)"

# ---------------------------------------------------------------- 3. provider keys
step "Provider keys"
ask_secret SARVAM_API_KEY "speech-to-text + text-to-speech (required for voice)" "https://dashboard.sarvam.ai"
ask_secret GEMINI_API_KEY "default LLM via Google AI Studio (required; enable billing, free tier is 20 requests/day)" "https://aistudio.google.com/apikey"
if [[ -f infra/litellm/secrets/vertex-sa.json ]]; then
  ok "Vertex AI key found (infra/litellm/secrets/vertex-sa.json)"
  [[ -n "$(env_get VERTEXAI_PROJECT)" ]] || warn "VERTEXAI_PROJECT is empty in .env"
else
  printf '  %sOptional: Vertex AI (Gemini served from Mumbai) — see docs/guide.html#vertex%s\n' "$D" "$N"
fi

# ---------------------------------------------------------------- 3b. admin account
step "Admin account"
if [[ -n "$(env_get ADMIN_EMAIL)" && -n "$(env_get ADMIN_PASSWORD)" ]]; then
  ok "Owner account $(env_get ADMIN_EMAIL) is created on first start (if no accounts exist yet)"
elif [[ $INTERACTIVE == 1 ]]; then
  printf '  The dashboard needs an email + password sign-in. Create the owner account now,\n  or press Enter to create it in the browser on the first visit to /login.\n'
  read -r -p "  Owner email (Enter to skip): " admin_email
  if [[ -n "$admin_email" ]]; then
    while :; do
      read -r -s -p "  Password (10+ chars, letters plus numbers or symbols): " admin_pw; echo
      read -r -s -p "  Repeat password: " admin_pw2; echo
      if [[ "$admin_pw" != "$admin_pw2" ]]; then warn "Passwords don't match, try again"; continue; fi
      if (( ${#admin_pw} < 10 )); then warn "Too short, try again"; continue; fi
      break
    done
    env_set ADMIN_EMAIL "$admin_email"
    env_set ADMIN_PASSWORD "$admin_pw"
    ok "Owner account will be created on first start. Change the password in Admin → your account later."
  else
    warn "Skipped: open http://localhost:3000/login after start to create the owner account"
  fi
else
  warn "No ADMIN_EMAIL/ADMIN_PASSWORD: create the owner account at http://localhost:3000/login"
fi

if [[ $START == 0 ]]; then
  step "Done (--no-start)"; echo "  Start later with: make up"; exit 0
fi

# ---------------------------------------------------------------- 4. build + start
step "Building and starting containers"
printf '  %sFirst build downloads ~1.5 GB of images and Python packages. If PyPI is slow\n  on your network the agent image can take 20–40 min; later builds are cached.%s\n' "$D" "$N"
docker compose up -d --build 2>&1 | grep -E "Built|Started|Running|Healthy|Error|error" | sed 's/^/  /' || true

# ---------------------------------------------------------------- 5. wait for health
step "Waiting for services to become healthy"
services=(postgres redis api litellm agent web)
deadline=$(( $(date +%s) + 240 ))
while :; do
  pending=()
  for s in "${services[@]}"; do
    cid=$(docker compose ps -q "$s" 2>/dev/null)
    st=$( [[ -n "$cid" ]] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo missing)
    [[ "$st" == healthy || "$st" == running ]] || pending+=("$s:$st")
  done
  (( ${#pending[@]} == 0 )) && break
  if (( $(date +%s) > deadline )); then
    warn "Still not healthy: ${pending[*]}"
    warn "Inspect with: docker compose logs --tail=50 <service>"
    break
  fi
  sleep 3
done
(( ${#pending[@]} == 0 )) && ok "All core services healthy"

# ---------------------------------------------------------------- 6. verify
step "Verifying"
if health=$(curl -fsS --max-time 5 localhost:4000/health 2>/dev/null); then
  ok "API readiness: $health"
else
  warn "API /health not OK yet — try 'make health' in a minute"
fi

if [[ -n "$(env_get GEMINI_API_KEY)" ]]; then
  key=$(env_get LITELLM_MASTER_KEY)
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 localhost:4100/v1/chat/completions \
    -H "Authorization: Bearer $key" -H 'content-type: application/json' \
    -d '{"model":"agent-fast","messages":[{"role":"user","content":"Reply with OK"}],"max_tokens":5}' || echo 000)
  [[ "$code" == 200 ]] && ok "LLM (agent-fast via LiteLLM) responds" || warn "LLM test returned HTTP $code — check GEMINI_API_KEY"
fi
[[ -n "$(env_get SARVAM_API_KEY)" ]] || warn "No SARVAM_API_KEY: calls will connect but the agent will report a config error"
if curl -fsS --max-time 5 localhost:4000/v1/auth/status 2>/dev/null | grep -q '"needsSetup":true'; then
  warn "No admin account yet: open http://localhost:3000/login to create the owner account"
else
  ok "Admin sign-in ready"
fi

# ---------------------------------------------------------------- 7. next steps
step "Ready"
cat <<EOF
  Demo (use Chrome, allow the microphone):  http://localhost:3000/demo
  Admin dashboard (sign in):                 http://localhost:3000/admin
  API health:                                http://localhost:4000/health
  User guide:                                docs/guide.html

  Useful:  make ps | make logs s=agent | make health | make down
  Network changed (new Wi-Fi)?  make ip
EOF
