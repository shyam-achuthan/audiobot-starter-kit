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
| http://localhost:3000/admin | Admin dashboard (sign in): overview charts, calls, leads, tickets, agent settings, knowledge, integrations, users |
| http://localhost:3000/admin/setup | First-run product setup (business profile, knowledge, test call) |
| http://localhost:4000/health | API readiness JSON |
| http://localhost:9001 | RustFS console (S3 keys in `.env`) |
| http://localhost:4100 | LiteLLM gateway (master key in `.env`) |

Add provider keys to `.env` (`SARVAM_API_KEY`, `GEMINI_API_KEY`, …) and run `make up` again.

> **Gemini billing:** enable billing on the Gemini key in Google AI Studio. The free tier allows only 20 requests a day per model, which a couple of test calls use up.

**First sign-in:** `./setup.sh` offers to create the owner account; otherwise open `/login` and create it there (only possible while no accounts exist). Lost the password? `make admin-password email=you@example.com`.

**CRM and helpdesk (optional):** `make up-crm` starts a local Twenty CRM (http://localhost:3020) and Chatwoot (http://localhost:3030); `make crm-setup` connects them. Leads then appear in Twenty and tickets in Chatwoot automatically, and resolving a conversation in Chatwoot resolves the ticket. Any other system can receive signed webhooks (Admin → Integrations).

**Recording and tracing (optional):** `make up-rec` adds the call recorder (LiveKit Egress); recordings play on each call page. Each agent's *Recording consent* setting decides whether callers are told and can opt out (default), are asked first, or aren't recorded; retention is under Admin → Setup. `make up-obs` starts Langfuse (http://localhost:3040, login in `.env`) with a trace of every LLM call, linked from the call page.

**Phone calls (optional):** `make up-sip` starts the LiveKit SIP bridge. Add numbers under Admin → Phone and pick which agent answers each; point your SIP trunk (or a softphone) at the address shown there. With `SIP_OUTBOUND_*` set in `.env`, agents call customers back ("Call now" on tickets, scheduled callbacks, or `POST /v1/calls/outbound`) within calling hours and never to numbers on the do-not-call list, and can transfer a caller to a person. `make sip-test` runs a smoke test with a scripted test phone.

**Website widget:** under Admin → Widgets, create a widget, list the websites allowed to use it, and paste the snippet (`<script src=".../widget.js" data-key="wk_..." async>`) into your site. Visitors get a voice button with live captions; per-widget limits cap concurrent calls and call length.

Then open `/admin/setup`: describe your business and add documents, FAQs or web pages to a knowledge base. Agents quote prices and policies only from that knowledge base. Each agent's instructions, LLM, voice and turn timing can be changed under **Agents**; changes apply to the next call. A sample pack for a fictional product is in [samples/knowledge](samples/knowledge).

### Notes
- **Network changes:** LiveKit advertises your Mac's LAN IP, so browsers and containers can both reach it. After switching Wi-Fi, run `make ip`.
- `make logs s=agent` tails a single service. `make down` stops everything. `make clean` also deletes data.

## Layout

```
api/      NestJS API (tokens, business logic, webhooks, CRM sync)
agent/    Python LiveKit Agents worker (conversation)
web/      Next.js admin + demo page
infra/    LiveKit, LiteLLM, Postgres config
scripts/  helper scripts
samples/  sample knowledge pack (fictional QuickBill product)
docs/     setup & user guide (guide.html)
```
