# AudioBots

Low-latency voice agents (sales, support, lead qualification) for the web and SIP, built on self-hosted LiveKit. See [PLAN.md](PLAN.md) for the architecture and the phases.

**Full setup & user guide:** open [docs/guide.html](docs/guide.html) in a browser (architecture, configuration, latency, troubleshooting).

## Quick start (local, Docker)

```bash
./setup.sh     # checks prerequisites, creates .env, asks for keys, builds, starts, verifies
```

Or step by step:

```bash
make up        # creates .env (secrets + LAN IP), builds and starts the core stack
make health    # API readiness: postgres, livekit, litellm
```

| URL | What |
|---|---|
| http://localhost:3000/demo | Demo page (starts a call with the agent) |
| http://localhost:3000/admin | Admin: health, product setup, knowledge bases |
| http://localhost:3000/admin/setup | First-run product setup (business profile, knowledge, test call) |
| http://localhost:4000/health | API readiness JSON |
| http://localhost:9001 | RustFS console (S3 keys in `.env`) |
| http://localhost:4100 | LiteLLM gateway (master key in `.env`) |

Add provider keys to `.env` (`SARVAM_API_KEY`, `GEMINI_API_KEY`, …) and run `make up` again.

> **Gemini billing:** enable billing on the Gemini key in Google AI Studio. The free tier allows only 20 requests a day per model, which a couple of test calls use up.

Then open `/admin/setup`: describe your business and add documents, FAQs or web pages to a knowledge base. Agents quote prices and policies only from that knowledge base. A sample pack for a fictional product is in [samples/knowledge](samples/knowledge).

### Notes
- **Network changes:** LiveKit advertises your Mac's LAN IP, so browsers and containers can both reach it. After switching Wi-Fi, run `make ip`.
- `make logs s=agent` tails a single service. `make down` stops everything. `make clean` also deletes data.

## Layout

```
api/      NestJS API (tokens, business logic, webhooks)
agent/    Python LiveKit Agents worker (conversation)
web/      Next.js admin + demo page
infra/    LiveKit, LiteLLM, Postgres config
scripts/  helper scripts
samples/  sample knowledge pack (fictional QuickBill product)
docs/     setup & user guide (guide.html)
```
