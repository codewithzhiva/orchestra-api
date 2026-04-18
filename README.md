# orchestra-api

Open-source multi-agent orchestration API. Define agent graphs as JSON, run them, stream events over SSE. MCP-friendly `Authorization: Bearer` auth — drop-in usable from a Claude skill or MCP server.

> Status: early / WIP. Feedback and PRs welcome.

## Stack

- **Fastify** — HTTP + SSE
- **LangGraph.js** — stateful agent graphs
- **Ollama** — local LLMs (bring any model)
- **BullMQ + Redis** — durable run queue
- **SQLite (better-sqlite3)** — graphs, runs, keys, events
- **argon2** — hashed API keys
- **TypeScript** — strict mode

Zero cloud dependencies. Runs on a laptop.

## Quick start

```bash
cp .env.example .env
# edit ADMIN_TOKEN to something long + random

pnpm install
docker compose up -d              # redis + ollama
docker exec -it $(docker ps -qf name=ollama) ollama pull llama3.1

pnpm dev                          # API on :3030
pnpm worker                       # in another terminal
```

## Auth

Every endpoint except `/health` requires `Authorization: Bearer <token>`.

**Bootstrap an API key** (admin only — uses `ADMIN_TOKEN` from env):

```bash
curl -X POST http://localhost:3030/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-skill","scopes":["graphs:write","graphs:read","runs:write","runs:read"]}'
```

Response contains `token` — store it. Format: `ok_<id>.<secret>`. Only shown once.

Scopes: `graphs:read`, `graphs:write`, `runs:read`, `runs:write`.

## Define a graph

```bash
curl -X POST http://localhost:3030/graphs \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "research-write-review",
    "entry": "research",
    "nodes": [
      {"id":"research","type":"llm","prompt":"Research: {{input}}. List 5 facts."},
      {"id":"write","type":"llm","prompt":"Write a short article using:\n{{research}}"},
      {"id":"review","type":"llm","prompt":"Critique this article:\n{{write}}"}
    ],
    "edges": [
      {"from":"research","to":"write"},
      {"from":"write","to":"review"}
    ]
  }'
```

Prompt templates support `{{input}}` and `{{nodeId}}` interpolation.

## Run it

```bash
curl -X POST http://localhost:3030/runs \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"graphId":"g_xxx","input":"fusion reactors"}'
# => { "id": "r_yyy", "status": "queued" }
```

**Stream live events (SSE):**

```bash
curl -N http://localhost:3030/runs/r_yyy/events \
  -H "Authorization: Bearer $API_KEY"
```

Event types: `run.started`, `node.started`, `node.finished`, `run.finished`, `run.failed`. History replays from seq 0 on connect, then streams live.

**Get final result:**

```bash
curl http://localhost:3030/runs/r_yyy \
  -H "Authorization: Bearer $API_KEY"
```

## Endpoints

| Method | Path | Scope | Purpose |
|--------|------|-------|---------|
| `GET`  | `/health` | — | Liveness |
| `POST` | `/keys` | admin | Mint API key |
| `POST` | `/graphs` | `graphs:write` | Create graph |
| `GET`  | `/graphs` | `graphs:read` | List graphs |
| `GET`  | `/graphs/:id` | `graphs:read` | Get graph |
| `DELETE` | `/graphs/:id` | `graphs:write` | Delete graph |
| `POST` | `/runs` | `runs:write` | Queue run |
| `GET`  | `/runs/:id` | `runs:read` | Run status + output |
| `GET`  | `/runs/:id/events` | `runs:read` | SSE event stream |

## Using from an MCP server / Claude skill

Bearer auth + REST + SSE = works natively with MCP SDKs and `fetch`. Typical skill flow:

1. Skill calls `POST /graphs` once to register its graph.
2. For each user request, skill calls `POST /runs`.
3. Skill streams `/runs/:id/events` or polls `/runs/:id` until `status=finished`.

## Roadmap

- [ ] Tool nodes (HTTP, shell, retrieval)
- [ ] Conditional edges + cycles
- [ ] Per-node model override + temperature
- [ ] OpenAI / Anthropic provider plugins
- [ ] Reference MCP server (`orchestra-mcp`)
- [ ] React Flow visualizer (separate repo)

## License

MIT
