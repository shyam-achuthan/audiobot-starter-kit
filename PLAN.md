# AudioBots — Build Plan

Low-latency voice bot for the Indian market. Works on the website (WebRTC) and over phone (SIP).
Uses open-source parts wherever it can. Every provider can be swapped by config. Everything runs in Docker.

---

## 1. Confirmed decisions

| Area | Decision |
|---|---|
| Voice framework | **LiveKit**: self-hosted server, Agents (Python) and LiveKit SIP |
| Languages (v1) | Indian English, Hindi and Hinglish, Tamil, Telugu, Kannada, Malayalam |
| Hosting | Local Docker on the Mac now. Indian GPU cloud later (compose profiles stay the same) |
| Provider strategy | **Hybrid and pluggable**: start on hosted APIs. Self-hosted open models are added later as containers and switched on by config |
| STT | **Sarvam `saaras:v4`** (hosted; Saarika models are retired). Language auto-detected, code-mixed speech supported |
| TTS | **Sarvam `bulbul:v3`** (hosted). The voice switches to the caller's language |
| LLM | **LiteLLM gateway** (self-hosted). Default `agent-fast` = **Gemini Flash-Lite** (thinking models were too slow for voice); `agent-smart` = Gemini 3.5 Flash with thinking off; GPT-4o-mini / Claude Haiku as fallbacks |
| Embeddings | **Configurable through LiteLLM**: Vertex AI, AWS Bedrock, OpenRouter, or a local BGE-M3 container. Chosen per knowledge base in Admin |
| VAD / turn-taking | Silero VAD and the LiveKit multilingual turn-detector, with interruption (barge-in) support |
| Workflows (v1) | Router/Receptionist, then Lead Qualification, Sales and Support (with handoffs between them) |
| System of record | **Own Postgres with pgvector**, plus **outbound webhooks** |
| Local CRM / helpdesk | **Twenty CRM** and **Chatwoot** in the stack, synced from webhooks, so every flow can be checked locally |
| Backend API | **NestJS** (TypeScript) with **Sequelize** (`sequelize-typescript`, Umzug migrations run on startup) |
| Bookings (v1) | **Callback requests only**: agents capture a preferred callback time as a high-priority callback ticket; no calendar |
| Human handoff (until SIP) | **Callback ticket**: when a caller asks for a person, the agent confirms name and phone and books a high-priority callback |
| Admin and demo | **Next.js** with shadcn/ui. The demo page embeds the real widget |
| Web widget | Small TypeScript bundle (Vite), embedded with one `<script>` tag |
| Observability | **Langfuse** (self-hosted) for LLM traces, plus per-stage latency metrics in Postgres |
| Recording | LiveKit Egress writes to **RustFS** (S3-compatible, Apache-2.0; MinIO stopped publishing Docker images). A consent prompt plays before recording |
| SIP trunk | **Decide later.** Build SIP generically and test locally with a softphone. Pick Exotel, Plivo or Tata before go-live |

### Embeddings: is per-provider choice possible? Yes
LiteLLM exposes one OpenAI-compatible `/embeddings` endpoint over all of these:
- **Google Vertex AI**: `gemini-embedding-001` / `text-multilingual-embedding-002`
- **AWS Bedrock**: Cohere `embed-multilingual-v3` / Titan Embed v2
- **OpenRouter**: embedding models wherever OpenRouter offers them for the account (to be confirmed during build)
- **Local BGE-M3**: Infinity/TEI container. Free, multilingual, Indic-capable

Each knowledge base stores its `embedding_model` and `dimension`. Changing either re-indexes that knowledge base. The pgvector column size is set per knowledge base, using separate tables or a fixed max dimension.

---

## 2. Architecture

```
 Browser widget ──WebRTC──┐                         ┌── Sarvam STT (Saarika)
                          ├──► LiveKit Server ◄──► Agent Worker (Python, LiveKit Agents)
 Phone ──SIP trunk──► LiveKit SIP ┘     │              ├── LiteLLM ──► Gemini / GPT / Claude / (vLLM later)
                                        │              ├── Sarvam TTS (Bulbul)
                                  LiveKit Egress       └── Tools ──HTTP──► NestJS API
                                        │                                  │
                                      RustFS                Postgres + pgvector ── webhooks ──► Twenty CRM
                                                                   │                            Chatwoot
                                                                Langfuse ◄── traces    Next.js Admin + Demo
```

**Key principle:** the Python agent handles only the conversation. All business logic sits behind the NestJS API. That covers leads, tickets, knowledge-base search, meeting booking, transfers and webhooks. The agent reaches it through a small set of HTTP tools, so the TypeScript side owns the data and the integrations.

---

## 3. Docker Compose services and profiles

| Profile | Services |
|---|---|
| `core` | `livekit`, `redis`, `agent-worker`, `litellm`, `api` (NestJS), `web` (Next.js admin and demo, serves the widget bundle), `postgres` (pgvector), `rustfs` |
| `sip` | `livekit-sip` (UDP 5060 and the RTP range mapped) |
| `recording` | `livekit-egress` |
| `observability` | `langfuse-web`, `langfuse-worker`, `clickhouse` (reuses postgres, redis and rustfs) |
| `crm` | `twenty-server`, `twenty-worker`, `chatwoot-web`, `chatwoot-sidekiq` (own DBs on the shared postgres, plus redis) |
| `local-models` | `embeddings` (BGE-M3 via Infinity). Later: `vllm`, `indicconformer`, `kokoro`, `indic-parler` |

- `make up`: core only. `make up-all`: everything (heavy on a Mac, so run CRM and Langfuse only when needed).
- **Mac caveat:** WebRTC and SIP need UDP. LiveKit runs with `use_external_ip: false` and mapped UDP ports, which works on Docker Desktop. On the Linux GPU host it switches to `network_mode: host`.

---

## 4. Repository layout

```
audiobots/
├── docker-compose.yml          # profiles as above
├── .env.example                # all keys documented
├── Makefile
├── infra/
│   ├── livekit/livekit.yaml, sip.yaml, egress.yaml
│   ├── litellm/config.yaml     # model aliases: agent-fast, agent-smart, embed-default …
│   ├── postgres/init/*.sql     # creates app, twenty, chatwoot, langfuse DBs + pgvector
│   └── rustfs/
├── agent/                      # Python — LiveKit Agents worker
│   ├── agents/router.py, lead_qual.py, sales.py, support.py
│   ├── pipeline/               # STT/TTS/LLM factory from agent config (pluggable)
│   ├── tools/                  # HTTP clients → NestJS API
│   ├── metrics/                # per-turn latency capture
│   └── Dockerfile
├── api/                        # NestJS
│   └── src/modules/ agents, calls, livekit (tokens, webhooks, SIP dispatch),
│                     knowledge (ingest, chunk, embed, search), leads, tickets,
│                     webhooks (outbound + retries), integrations (twenty, chatwoot)
├── web/                        # Next.js — /admin/*, /demo
└── widget/                     # Vite TS bundle → audiobots-widget.js
```

---

## 5. Data model (Postgres, app DB)

- `agents`: name, type (router/lead/sales/support), system prompt, LLM alias, voice per language, tools enabled, handoff targets, version
- `knowledge_bases`, `documents`, `chunks` (text, embedding vector, metadata)
- `calls`: channel (web/sip), from/to, language detected, agent path, start/end, outcome, recording URL, consent flag
- `call_turns`: role, text, language, timestamps, latency breakdown (EOU→STT final, LLM TTFT, TTS TTFB, total)
- `leads`: name, phone, email, company, BANT fields, score, status, source call
- `tickets`: subject, description, priority, status, external ids (Chatwoot)
- ~~`meetings`~~: not needed in v1. Callback requests are `tickets` with `type=callback` and a preferred time
- `webhook_endpoints`, `webhook_deliveries` (events: `call.started|ended`, `lead.created|updated`, `ticket.created`, `meeting.booked`)

---

## 6. Agent workflows

**Router / Receptionist.** Greets the caller and detects language and intent (sales, support or qualification). If needed it plays the consent and recording disclosure and states that the caller is talking to AI. Then it hands off to the right agent.

**Lead Qualification.** Fills in BANT slots: budget, need/authority, timeline, and contact details with confirmation. It scores the lead, then calls `create_lead`. It also calls `book_meeting` (or offers a callback) and may hand off to Sales.

**Sales.** Answers from the product and pricing knowledge base with `search_kb`. It handles objections from a playbook in the prompt, and calls `update_lead` and `transfer_to_human` (warm transfer over SIP, or a callback request on web).

**Support.** Answers FAQs and docs with `search_kb`. It looks up existing tickets with `lookup_ticket` and opens new ones with `create_ticket`, then escalates with `transfer_to_human`.

**Shared tools:** `end_call`, `switch_language`, `handoff(agent)`.
**Shared behaviour:**
- The agent replies in the caller's language.
- It plays a short filler line while slow tools run.
- When interrupted, it cancels TTS and the LLM request immediately.

---

## 7. Latency targets and techniques

Target **≤ 800 ms** from the user stopping to the bot's first audio. Stretch goal: ~600 ms.

- Everything is streamed: STT partials, LLM tokens, and TTS in chunks per sentence.
- The LLM can start early on a confident partial transcript (preemptive generation).
- System prompts stay short and use LiteLLM/provider prompt caching. The fast model is the default, and the smart model is used per agent only where needed.
- Every stage is timed on every turn and shown in Admin (p50/p95). A latency regression is a bug.
- Later: GPU host in Mumbai with self-hosted STT/TTS/LLM, all in the same region.

---

## 8. Build phases

| # | Phase | Done when |
|---|---|---|
| 0 ✅ | **Scaffold**: repo, compose `core`, Postgres init, `.env.example`, Makefile | `make up` boots LiveKit, API, web and the agent, all healthy |
| 1 ✅ | **Voice loop**: Sarvam STT/TTS, LiteLLM to Gemini, VAD, turn detection, barge-in, latency metrics | Talking on `/demo` in English, Hindi and Tamil works, with per-turn latency logged |
| 2 ✅ | **Workflows**: Router plus the 3 agents, handoffs, tools against the NestJS API, calls and turns stored | Each flow can be completed end-to-end (scripted scenario calls pass), and the lead, ticket and callback rows appear in Postgres |
| 3 | **Knowledge base / RAG**: upload, chunk, embed (provider chosen per KB), pgvector search | Sales and Support answer from uploaded docs, and switching the embedding provider re-indexes |
| 4 | **Admin dashboard**: agents (prompts, models, voices), knowledge bases, calls with transcript and audio, leads, tickets, latency charts | Agent behaviour can be changed from the UI without a redeploy |
| 5 | **Integrations**: outbound webhooks with retries, Twenty and Chatwoot sync (`crm` profile) | A lead shows up in Twenty and a ticket in Chatwoot automatically |
| 6 | **Recording and observability**: Egress to RustFS, consent flow, Langfuse traces | Every call has a recording (if consented) and a full LLM trace |
| 7 | **SIP**: `livekit-sip`, inbound dispatch rules, outbound calls, warm transfer. Tested with a softphone | A call from Linphone/Zoiper goes through the same workflows. The SIP trunk is plugged in once chosen |
| 8 | **Widget hardening**: embed snippet, theming, mic permission UX, live transcript, reconnect, allowed-origin tokens | Pasting the snippet into any site works securely |
| 9 | **Self-host readiness**: `local-models` profile (vLLM with Qwen3/Sarvam-M, IndicConformer, Indic Parler/Kokoro), GPU compose override | The hosted to self-hosted swap is done by config alone, benchmarked against hosted |

---

## 9. Keys and accounts needed

- **Sarvam AI** API key (STT and TTS), needed from phase 1
- **Google**: AI Studio key (Gemini) or Vertex service account (also covers Vertex embeddings)
- **Optional:** OpenAI, Anthropic, OpenRouter keys and AWS Bedrock credentials (fallbacks and embedding choices)
- LiveKit API key and secret: generated locally

## 10. Compliance (India)

- Disclose AI and get consent for recording at the start of every call (DPDP Act 2023)
- PII stays in the self-hosted Postgres. Recordings and transcripts have configurable retention
- Outbound calling (later): 140-series numbers for promotional calls and 160-series for service calls, scrubbed against the NCPR Do-Not-Disturb registry, and only through a licensed SIP trunk provider

## 11. Open decisions (later)

1. SIP trunk provider (Exotel, Plivo or Tata/Airtel), needed before phase 7 goes live
2. GPU cloud (E2E, AWS Mumbai, Yotta), needed before phase 9
3. Admin authentication (simple email/password vs Google SSO)
4. Production domain and TLS (Caddy/Traefik in front of LiveKit and the web app)
