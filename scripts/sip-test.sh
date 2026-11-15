#!/usr/bin/env bash
# Phone smoke test with the scripted test phone (infra/testphone, baresip).
#
#   scripts/sip-test.sh inbound  +918045670001   # dial that number (add it in Admin -> Phone first)
#   scripts/sip-test.sh outbound +919845012345   # the agent calls the test phone; needs
#                                                # SIP_OUTBOUND_ADDRESS=testphone:5070 in .env (test only)
#
# Prints what the API stored for the call (agent, transcript, recording).
set -euo pipefail
cd "$(dirname "$0")/.."

kind=${1:-inbound}
number=${2:-}
[[ -n "$number" ]] || { echo "usage: $0 inbound|outbound <number>" >&2; exit 2; }
token=$(grep -E '^AGENT_API_TOKEN=' .env | cut -d= -f2-)
api=http://127.0.0.1:4000

echo "· building caller audio ($kind)"
docker compose run --rm --no-deps -v "$PWD/agent:/app" -v "$PWD/infra/testphone/audio:/audio" \
  agent python scripts/sip_audio.py "$kind" | tail -1

started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [[ "$kind" == "inbound" ]]; then
  echo "· dialling $number from the test phone"
  docker compose --profile sip-test run --rm --entrypoint sh testphone \
    -c "timeout 60 baresip -f /root/.baresip -e '/dial sip:${number}@sip:5060' 2>&1" \
    | tr '\r' '\n' | grep -aE "Call established|terminated|SIP Progress: [4-6]" || true
else
  echo "· starting the test phone (auto-answer) and asking the API to call $number"
  docker compose --profile sip-test run -d --rm --use-aliases --name audiobots-testphone-answer \
    --entrypoint sh testphone -c 'timeout 90 baresip -f /root/.baresip >/audio/phone.log 2>&1' >/dev/null
  sleep 3
  curl -fsS -X POST "$api/v1/calls/outbound" -H "Authorization: Bearer $token" -H 'content-type: application/json' \
    -d "{\"phone\":\"$number\",\"workflow\":\"support\",\"context\":\"A short test call from AudioBots.\"}"
  echo
  sleep 75
  tr '\r' '\n' < infra/testphone/audio/phone.log | grep -aE "Call established|terminated" || true
fi

sleep 5
echo "· stored call"
id=$(curl -fsS "$api/v1/calls?channel=sip&limit=1&from=$started" -H "Authorization: Bearer $token" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin)["items"]; print(d[0]["id"] if d else "")')
[[ -n "$id" ]] || { echo "FAIL: no phone call was stored"; exit 1; }
curl -fsS "$api/v1/calls/$id" -H "Authorization: Bearer $token" | python3 -c '
import sys, json
c = json.load(sys.stdin)
print(f"call {c[\"id\"]}: {c[\"direction\"]} {c[\"remoteNumber\"]} -> agent {c[\"startWorkflow\"]}, "
      f"{c[\"turnCount\"]} turns, dial={c.get(\"dialStatus\")}, recording={c[\"recording\"][\"status\"]}")
for t in c["turns"]:
    if t["userText"]: print("  caller:", t["userText"])
    if t["agentText"]: print("  agent: ", t["agentText"][:160])
ok = c["turnCount"] >= 2
print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
'
