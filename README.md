# AI Assistant WhatsApp

Open-source AI assistant that works through **WhatsApp** and **Telegram**. Manages your email, calendar, files, and tasks using voice or text — powered by multiple AI models.

> **Status: Active Development** — Core bot with 40+ tools works. See [Roadmap](#roadmap) for details.

## What it does

Send a message (text or voice) to your bot and it can:

- **Email**: Search, read, send, reply, forward with attachments (Gmail + Outlook)
- **Calendar**: Create, update, delete events (Google Calendar + Outlook Calendar)
- **Files**: Browse, download, send files (Google Drive + OneDrive)
- **Tasks**: Manage to-do lists (Google Tasks + Microsoft To Do)
- **Documents**: Generate PDFs and Excel files on the fly
- **Automation**: Schedule recurring tasks ("every Monday check my emails")
- **Voice**: Send audio messages, the AI transcribes and responds
- **Memory**: Remembers your preferences and context across conversations

## Demo

```
You:  "Search my emails from Amazon this week"
Bot:  Found 3 emails from Amazon:
      1. Order shipped - AirPods Pro (Mar 22)
      2. Delivery confirmed (Mar 23)
      3. Rate your purchase (Mar 24)

You:  "Forward the shipping one to maria@company.com"
Bot:  Done. Forwarded "Order shipped - AirPods Pro" to maria@company.com
      with the tracking PDF attached.

You:  🎤 (voice) "Create a meeting tomorrow at 3 PM with the design team"
Bot:  Created: "Design Team Meeting"
      Tomorrow, 3:00 PM - 4:00 PM
      Google Calendar
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  WhatsApp   │────▶│   Channels  │────▶│   Worker    │
│  Telegram   │◀────│   Service   │◀────│   Service   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                    │
                    ┌──────┴──────┐      ┌──────┴──────┐
                    │    Redis    │      │  AI Models  │
                    │   BullMQ   │      │ Grok/Gemini │
                    └─────────────┘      └─────────────┘
                           │
                    ┌──────┴──────┐
                    │ PostgreSQL  │
                    │ + pgvector  │
                    └─────────────┘
```

## AI Tools (40+)

| Category | Tools | Platform |
|----------|-------|----------|
| Email | search, read, send, reply, forward, trash, mark read, get attachments | Gmail + Outlook |
| Calendar | list, create, update, delete | Google + Microsoft |
| Files | list, search, download | Drive + OneDrive |
| Tasks | list, create, complete, delete | Google Tasks + To Do |
| Documents | create PDF (Puppeteer), create Excel (ExcelJS) | Local |
| Files | read, write, list user files | Local |
| Automation | scheduled tasks via cron expressions | Local |

## Multi-Model Router

Messages are automatically routed to the cheapest model that can handle them:

| Tier | Model | When | Cost (per 1M tokens) |
|------|-------|------|---------------------|
| Light | Grok 4.1 Fast | Text + images, tool calls | $0.20 / $0.50 |
| Standard | Gemini 2.5 Flash | Audio, multimodal | $0.30 / $2.50 |
| Complex | Grok 4.20 | Deep reasoning | $2.00 / $6.00 |

Falls back to Gemini if `XAI_API_KEY` is not set.

## Memory System

4-layer architecture that persists context across sessions:

| Layer | What it stores |
|-------|---------------|
| **Memory** | Facts about the user (auto-extracted on session close) |
| **Soul** | Personality and tone (configurable) |
| **Summaries** | Conversation summaries (generated on session rotation) |
| **Semantic search** | Vector similarity search via pgvector + Ollama |

## Quick Start

### Prerequisites

- Node.js 22+
- Docker

### 1. Clone and install

```bash
git clone https://github.com/AlbertoEJ/ai-assistant-whatsapp.git
cd ai-assistant-whatsapp
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

**Minimum required:**
- `GEMINI_API_KEY` — [Google AI Studio](https://aistudio.google.com/) (free tier)
- `TELEGRAM_BOT_TOKEN` — [@BotFather](https://t.me/BotFather)

**Optional:**
- `XAI_API_KEY` — [xAI Console](https://console.x.ai/) (Grok, cheaper for text)
- `GOOGLE_CLIENT_ID/SECRET` — Gmail, Calendar, Drive integration
- `MS_CLIENT_ID/SECRET` — Outlook, OneDrive integration
- `WHATSAPP_*` — WhatsApp Cloud API (requires Meta Business account)

### 3. Start infrastructure

```bash
docker compose up -d
```

### 4. Run migrations

```bash
DATABASE_URL=postgres://bot:bot@localhost:5432/bot node packages/db/src/migrate.js
```

### 5. Start the bot

```bash
# Terminal 1
node services/api/src/index.js

# Terminal 2
node services/channels/src/index.js

# Terminal 3
node services/worker/src/index.js
```

### 6. Talk to your bot

Open Telegram and send a message to your bot.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22+ (ESM, no TypeScript) |
| HTTP | Fastify 5 |
| Database | PostgreSQL 17 + pgvector |
| Queue | Redis 7 + BullMQ |
| AI | Vercel AI SDK v6 |
| Embeddings | Ollama + nomic-embed-text |
| Telegram | node-telegram-bot-api |
| WhatsApp | WhatsApp Cloud API |

## Project Structure

```
ai-assistant-whatsapp/
├── packages/
│   ├── core/              # Business logic
│   │   ├── ai/            # Runner, router, prompt builder
│   │   │   └── tools/     # 40+ AI tools
│   │   ├── files/         # File extractor (PDF, Office, images, audio)
│   │   ├── integrations/  # Google OAuth2, Microsoft Graph
│   │   └── memory/        # Memory, summaries, embeddings
│   ├── db/                # PostgreSQL migrations + repositories
│   └── shared/            # Config, logger, Redis, BullMQ
├── services/
│   ├── api/               # Webhooks (WhatsApp, OAuth callbacks)
│   ├── channels/          # Telegram + WhatsApp adapters
│   └── worker/            # AI message processing pipeline
├── docker-compose.yml
└── .env.example
```

## Roadmap

### Done
- [x] Telegram adapter (polling)
- [x] WhatsApp adapter (Cloud API webhooks)
- [x] Voice message support (Gemini native audio)
- [x] Gmail tools (8): search, read, send, reply, forward, trash, mark read, attachments
- [x] Outlook tools (10): list, search, read, send, reply, forward, trash, mark read, attachments
- [x] Google Calendar tools (4): list, create, update, delete
- [x] Outlook Calendar tools (4): list, create, update, delete
- [x] Google Drive tools (3): list, search, download
- [x] OneDrive tools (3): list, search, download
- [x] Google Tasks tools (4): list, create, complete, delete
- [x] Microsoft To Do tools (4): list, create, complete, delete
- [x] PDF generation (Puppeteer)
- [x] Excel generation (ExcelJS)
- [x] File read/write/list
- [x] Multi-model router (Grok + Gemini)
- [x] 4-layer memory (facts, soul, summaries, semantic search)
- [x] Session management (idle reset, daily reset, memory flush)
- [x] Cron/scheduled task execution
- [x] Typing indicator during processing
- [x] Structured system prompt with few-shot examples

### Planned
- [ ] Web search tool (Grok and Gemini support it natively)
- [ ] Proactive assistant (heartbeat — implemented but disabled)
- [ ] Push notifications (watchers for Gmail/Calendar changes)
- [ ] Multi-language support

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Submit a PR

## License

MIT — see [LICENSE](LICENSE)
