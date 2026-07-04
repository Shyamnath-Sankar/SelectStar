<div align="center">

<img src="public/screenshots/selectstar-logo.svg" alt="SelectStar Logo" width="120"/>

# SelectStar

**Talk to your database in plain English.**

SelectStar is an agentic database-analysis platform. Paste a connection string,
ask a natural-language question, and a team of specialized AI agents —
coordinated by a graph orchestrator — decides what's needed: querying the
database, profiling the data, building a chart, or running a quick ML model.
Every turn produces a conversational reply in the **chat pane** and structured
artifacts (tables, charts, SQL, model results) rendered in a **canvas pane**.

Think of it as sitting between a BI tool, a Jupyter notebook, and a chat
assistant — but agentic, so it decides the right *type* of analysis on its own
instead of you having to pick a chart type or write SQL manually.

⭐ **If you find SelectStar useful, please star us on GitHub!** ⭐

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Vega-Lite](https://img.shields.io/badge/Vega--Lite-6-orange?style=flat-square)](https://vega.github.io/vega-lite/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma)](https://prisma.io)

<br />

![SelectStar landing page](public/screenshots/01-landing.png "SelectStar landing page")

</div>

<br /><br />

## 🚀 Features

| Agent Pipeline | Safety & Control | Canvas Artifacts | Connectivity |
| -------------- | ---------------- | ---------------- | ------------ |
| Router classifies intent & picks agents | Read-only by default | Query result tables | SQLite via `better-sqlite3` |
| SQL agent writes & executes queries | Zen-mode toggle for writes | Vega-Lite charts (SVG) | PostgreSQL via `pg` |
| EDA agent profiles & computes stats | Per-write confirmation UI | Syntax-highlighted SQL | MySQL (architecture-ready) |
| Viz agent emits Vega-Lite specs | Dry-run with rollback | Statistical summaries | Any OpenAI-compatible LLM |
| ML agent (regression / k-means / forecast) | Full audit log | Model results with metrics | Demo DB included |

<br />

### 📸 Screenshots

<table width="100%">
  <tr>
    <td width="50%" align="center"><b>Landing page</b></td>
    <td width="50%" align="center"><b>Empty session with suggested questions</b></td>
  </tr>
  <tr>
    <td><img alt="SelectStar landing page with split-screen hero, agent pipeline visualization, and connection form" src="public/screenshots/01-landing.png" title="Landing page" /></td>
    <td><img alt="Connected session showing suggested starter questions based on the real schema" src="public/screenshots/02-empty-session.png" title="Suggested questions" /></td>
  </tr>
  <tr>
    <td align="center"><b>SQL agent — query result</b></td>
    <td align="center"><b>Viz agent — bar chart</b></td>
  </tr>
  <tr>
    <td><img alt="SQL agent executed a query, showing the SQL block and result table in the canvas" src="public/screenshots/03-sql-query.png" title="SQL query result" /></td>
    <td><img alt="Viz agent built a bar chart of top products by sales, rendered as Vega-Lite SVG" src="public/screenshots/04-chart.png" title="Bar chart" /></td>
  </tr>
  <tr>
    <td align="center"><b>EDA agent — statistical summary</b></td>
    <td align="center"><b>ML agent — k-means clustering</b></td>
  </tr>
  <tr>
    <td><img alt="EDA agent produced a statistical summary with null bars, correlations, and column profiles" src="public/screenshots/05-eda.png" title="EDA summary" /></td>
    <td><img alt="ML agent clustered products into 3 groups with metrics and predictions table" src="public/screenshots/06-ml-clustering.png" title="ML clustering" /></td>
  </tr>
  <tr>
    <td align="center"><b>Schema browser</b></td>
    <td align="center"><b>Zen mode enabled</b></td>
  </tr>
  <tr>
    <td><img alt="Schema browser sheet showing tables, columns, primary and foreign keys" src="public/screenshots/07-schema-browser.png" title="Schema browser" /></td>
    <td><img alt="Zen mode toggle enabled in the top bar, allowing write operations with confirmation" src="public/screenshots/08-zen-mode-on.png" title="Zen mode" /></td>
  </tr>
  <tr>
    <td align="center"><b>Pending write — confirmation UI</b></td>
    <td align="center"><b>Audit log</b></td>
  </tr>
  <tr>
    <td><img alt="Pending write with impact estimate and Confirm / Dry-run / Cancel actions" src="public/screenshots/09-pending-write.png" title="Pending write" /></td>
    <td><img alt="Audit log sheet showing all executed and rolled-back write statements" src="public/screenshots/10-audit-log.png" title="Audit log" /></td>
  </tr>
</table>

<br /><br />

## 🧠 How It Works — Agentic Orchestration Without Python

> **"Wait — no Python, no FastAPI, no LangGraph? How did you orchestrate the agents?"**

This is the most common question. Here's the honest, detailed answer.

### The spec called for Python. We adapted it to TypeScript.

The original product spec called for **Python 3.11 + FastAPI + LangGraph + SQLAlchemy + pandas/scikit-learn**. That's an excellent stack. But this project runs in a **Next.js 16 + TypeScript** environment, so we adapted every Python concept to its TypeScript-native equivalent — **without losing any of the architectural ideas**. Here's the mapping:

| Concept in the spec (Python) | SelectStar's implementation (TypeScript) | Why it's equivalent |
| ---------------------------- | ---------------------------------------- | ------------------- |
| **FastAPI** endpoints | **Next.js API Routes** (`src/app/api/*`) | Both are async server endpoints with streaming support. Next.js Route Handlers return `Response` objects, so we stream SSE identically. |
| **LangGraph** graph with conditional edges | **Custom TypeScript orchestrator** (`src/lib/agents/orchestrator.ts`) | LangGraph is "a graph with shared state + conditional edges." We model the exact same thing with a `runTurn()` function that branches on the router's output. See below. |
| **SQLAlchemy async** (dialect-agnostic) | **`DbConnection` interface** + `SqliteConnection` / `PostgresConnection` | Same abstraction: one interface, multiple drivers. Adding MySQL = implement one class. |
| **OpenAI-compatible client** | **`z-ai-web-dev-sdk`** via one shared `llm.ts` wrapper | The SDK is OpenAI-compatible. Swapping providers = change one client. Every agent calls `complete()` / `completeJson()` / `completeStream()`. |
| **pandas** dataframe handling | **`DataFrame` type + `frame-cache.ts`** | We store result sets server-side keyed by id, pass only the id + a small preview through LLM context — exactly the spec's "never serialize a large dataframe into a prompt." |
| **scikit-learn** (OLS, k-means) | **Pure-TS implementations** in `src/lib/agents/ml.ts` | Ordinary least squares via normal equations, k-means with k-means++ init, linear-trend forecasting. No Python runtime needed. |
| **Vega-Lite via react-vega** | **Same** — `react-vega` `VegaEmbed` | The viz agent emits declarative JSON specs the frontend renders as SVG. No executable plotting code ever runs. |
| **SSE streaming** to the frontend | **Same** — `text/event-stream` response | The `/api/chat` route returns a `ReadableStream` of `data: {...}\n\n` SSE events. |

### The orchestrator is a graph, not a loop

LangGraph's value is modeling the flow as a **graph with conditional edges and shared state**, not a flat ReAct "think → call tool → repeat" loop. We replicate that exactly. Here's the full graph:

```
                 ┌──────────────────────────────────────────────┐
                 │                                              ▼
   user message  │   ┌─────────┐    ┌─────────┐    ┌─────────────┐
        ─────────┴──►│ ROUTER  │───►│  SQL    │───►│  (write?)   │
                     │ classifies│   │ writes &│    │  gated?     │
                     │ intent    │   │ executes│    └──┬───────┬──┘
                     └─────┬─────┘   └────┬────┘       │       │
                           │              │            no      yes
                           │              │            │       │
              ┌────────────┤              │            ▼       ▼
              │            │              │     ┌──────────┐  STOP —
              ▼            │              │     │ EDA      │  await user
         ┌─────────┐       │              │     │ Viz      │  confirm
         │ SCHEMA  │       │              │     │ ML       │
         │ lookup  │       │              │     │ (parallel)│
         └─────────┘       │              │     └────┬─────┘
                           │              │          │
                           │              │          ▼
                           │              │     ┌──────────┐
                           └──────────────┴────►│SYNTHESIS │──► streamed reply
                                                 │ writes   │    + canvas
                                                 │ the chat │    objects
                                                 │ reply    │
                                                 └──────────┘
```

**Shared state** flows through this graph as a single `AgentState` object (a `TypedDict` equivalent):

```typescript
// src/lib/types.ts
export interface AgentState {
  sessionId: string;
  dialect: Dialect;
  schemaSnapshot: SchemaSnapshot | null;   // cached introspection
  zenMode: boolean;                         // write toggle
  messages: AgentMessage[];                 // conversation history
  userInput: string;
  routedAgents: AgentName[];                // router's decision
  lastResultId?: string;                    // id into frame-cache
  canvasObjects: CanvasObject[];            // artifacts to render
  steps: { agent: AgentName; label: string; ts: number }[];  // live status
  pendingWrite?: { pendingId: string; query: string; estimatedImpact: string } | null;
  reply?: string;                           // final chat text
  error?: string;
}
```

The orchestrator (`runTurn`) implements the conditional edges:

```typescript
// src/lib/agents/orchestrator.ts (simplified)
export async function runTurn(state: AgentState, cb: OrchestratorCallbacks) {
  // 1. ROUTER — classify intent (single fast LLM call, structured JSON output)
  const route = await runRouter(state);
  state.routedAgents = route.agents;

  // Short-circuit: no agents → just synthesize a conversational reply
  if (route.agents.length === 0) {
    const reply = await runSynthesis(state, [...], [], cb.emit);
    return { ...state, reply };
  }

  // 2. SCHEMA agent (if routed) — answers structural questions from cache
  if (route.agents.includes("schema")) {
    const out = await runSchemaAgent(state);
    // ... collect canvas objects + summary
  }

  // 3. SQL agent (if routed) — pass the downstream agents so it knows
  //    whether to return raw rows (for EDA/Viz/ML) or may use aggregates
  if (route.agents.includes("sql")) {
    const downstream = route.agents.filter(a => a !== "sql");
    const out = await runSqlAgent(state, downstream);

    if (out.pending) {
      // WRITE GATED — stop here, await user confirmation
      const reply = await runSynthesis(state, [...], canvas, cb.emit);
      return { ...state, reply, pendingWrite: out.pending };
    }
    if (out.result?.frameId) state.lastResultId = out.result.frameId;
  }

  // 4. EDA / Viz / ML — run in PARALLEL after a successful SELECT
  const downstream = route.agents.filter(a => ["eda","viz","ml"].includes(a));
  if (downstream.length && sqlRanSelect) {
    await Promise.all(downstream.map(a => runAgent(a, state)));
  }

  // 5. SYNTHESIS — the only node that writes user-facing prose
  //    Streams the reply token-by-token via SSE
  const reply = await runSynthesis(state, agentSummaries, canvas, cb.emit);
  return { ...state, reply, canvasObjects: canvas };
}
```

**This is a graph, not a loop.** Each node has one job, a small toolset, and a focused system prompt. The orchestrator decides which agents run — not the user, not the agents. Conditional edges route based on the router's classification. Multiple agents (EDA + Viz + ML) run in parallel after a SELECT. That's the LangGraph pattern, in TypeScript.

### The six agents

| Agent | Job | Tools | LLM calls |
| ----- | --- | ----- | --------- |
| **Router** | Classify the user's message into needed capabilities | `completeJson` | 1 fast call |
| **Schema** | Answer structural questions from the cached snapshot | Schema text lookup | 0 for pure lookups, 1 to phrase the answer |
| **SQL** | Generate & execute a single query; gate writes in Zen mode | `DbConnection.query` / `executeWrite`, `frame-cache` | 1 call (+ 1 regex-fallback retry) |
| **EDA** | Profile a dataframe: stats, nulls, distributions, correlations | `frame-cache` get | 1 call to phrase the narrative |
| **Viz** | Decide chart type & emit a Vega-Lite JSON spec | `frame-cache` get | 1 call + smart fallback |
| **ML** | Run OLS regression / k-means / linear-trend forecast | `frame-cache` get, pure-TS math | 1 call to pick the model |
| **Synthesis** | Write the final user-facing reply (streamed) | agent summaries + canvas list | 1 streaming call |

### Streaming without WebSockets

The `/api/chat` route returns a **`text/event-stream`** response. As each agent works, the orchestrator emits SSE events:

```
data: {"type":"step","agent":"router","label":"Understanding your question…"}

data: {"type":"step","agent":"sql","label":"Writing a SQL query…"}

data: {"type":"sql","query":"SELECT ...","executed":true,"rowCount":5,"durationMs":3}

data: {"type":"canvas","object":{"type":"table","columns":[...],"rows":[...]}}

data: {"type":"step","agent":"viz","label":"Building a chart…"}

data: {"type":"canvas","object":{"type":"chart","spec":{...}}}

data: {"type":"token","text":"The top 5 "}

data: {"type":"token","text":"products by sales "}

data: {"type":"reply_done","reply":"The top 5 products by sales ..."}

data: {"type":"done"}
```

The frontend reads this with a `fetch` + `ReadableStream` reader (not the native `EventSource` API, which only supports GET) and dispatches each event type to update the chat pane (steps, tokens) and canvas pane (objects) live.

> **Note on streaming:** The z-ai SDK's `stream: true` doesn't yield OpenAI-style delta chunks reliably, so our `completeStream()` uses non-streaming `complete()` and re-chunks the result into ~3-word pseudo-tokens emitted with a 12ms delay. This preserves the live "typing" feel in the UI while staying robust.

<br /><br />

## 🛡️ Zen Mode — The Safety-Critical Part

Treat this as non-negotiable, not a nice-to-have.

1. **Default state is read-only.** If the connected role lacks write privileges, the Zen-mode toggle is disabled entirely.
2. **Zen mode is an explicit per-session toggle**, off by default every new session.
3. When Zen mode is on and the SQL agent produces a write statement, **it is NEVER auto-executed**. It's registered as a pending write (10-minute TTL) and surfaced to the frontend with an impact estimate.
4. The user sees three actions: **Confirm & execute**, **Dry-run (rollback)**, **Cancel**. Dry-runs execute inside a transaction that is immediately rolled back, so the user sees the affected row count without committing.
5. **Every write resolution is audit-logged** — executed, rolled-back, cancelled, or failed — with the SQL text, timestamp, and row count.
6. **No agent other than the SQL agent can construct or execute SQL** against the live connection.

<br /><br />

## 🎨 The Canvas Concept

The canvas is a typed, ordered list of artifacts per session — not a chat bubble. It's a discriminated union shared between backend and frontend:

```typescript
// src/lib/types.ts
export type CanvasObject =
  | { type: "table"; columns: [...]; rows: [...]; totalRows?: number; truncated?: boolean }
  | { type: "chart"; spec: VegaLiteSpec; caption?: string }           // rendered by react-vega
  | { type: "sql"; query: string; executed: boolean; rowCount?: number; error?: string }
  | { type: "eda_summary"; columns: EdaColumnStats[]; insights?: string[] }
  | { type: "model_result"; modelType: string; metrics: Record<string, number>; predictions?: {...} }
  | { type: "pending_write"; query: string; estimatedImpact: string; pendingId: string }
  | { type: "error"; message: string };
```

The synthesis node appends to this list each turn. The frontend renders whatever's in it, in order. You can scroll back through previous charts and tables like a notebook, export tables to CSV, export charts to SVG/PNG, and copy SQL or message text.

<br /><br />

## ❗ System Requirements

- **Node.js 20+** (the project uses Next.js 16 with Turbopack)
- **bun** (package manager & script runner — the dev server uses `bun run dev`)
- A database to connect to:
  - **SQLite** — a file path, or just type `demo` to use the bundled e-commerce demo database
  - **PostgreSQL** — a `postgresql://` connection string (the `pg` driver is installed)
- An **OpenAI-compatible LLM**. SelectStar uses `z-ai-web-dev-sdk` out of the box; swapping in OpenAI, vLLM, Ollama, or LM Studio only requires changing the client in `src/lib/llm.ts`.

<br /><br />

## ⚡ Installation & Quick Start

### Prerequisites

```bash
node --version    # 20+
bun --version     # 1.0+
```

### 1. Clone & install

```bash
git clone <your-repo-url> selectstar
cd selectstar
bun install
```

### 2. Seed the demo database

SelectStar ships with a realistic e-commerce SQLite database (6 tables, ~3,200 orders, ~8,000 line items) so you can explore the full agent pipeline immediately:

```bash
bun run scripts/seed-demo.ts
```

This creates `db/demo.db` with `regions`, `customers`, `categories`, `products`, `orders`, and `order_items` tables.

### 3. Push the app database schema

SelectStar uses Prisma + SQLite to store its own sessions, messages, canvas objects, and audit logs:

```bash
bun run db:push
```

### 4. Start the dev server

```bash
bun run dev
```

Open **http://localhost:3000** in your browser. You'll see the landing page. Type `demo` in the connection string field and click **Connect** — you're in.

### 5. Try it

Once connected, you'll see suggested starter questions based on the real schema. Try:

- *"How many orders are there, broken down by status?"*
- *"Show me the distribution of order totals."*
- *"Chart the top 8 products by total sales as a bar chart"*
- *"Give me a statistical profile of the products table"*
- *"Cluster the products into 3 groups based on price and stock"*
- *"Forecast the next 6 months of order counts"*

Watch the chat pane for live agent steps (🧭 Router → ⌘ SQL → 📊 EDA / 📈 Viz / 🧠 ML → ✦ Synthesis) and the canvas pane for the structured results.

<br /><br />

## 🔌 Connecting to Your Own Database

### SQLite

```
sqlite:./path/to/your.db
```

Or just a bare file path: `./path/to/your.db`

### PostgreSQL

```
postgresql://user:password@host:5432/dbname
```

SelectStar introspects the schema via `information_schema` (tables, columns, primary keys, foreign keys, approximate row counts). Per-table COUNT queries have a 3-second `statement_timeout` so a single slow table on a remote database doesn't block the whole introspection.

### MySQL

MySQL is wired into the architecture (the `DbConnection` interface and the connection-string parser recognize `mysql://`) but the driver isn't installed in this build. Adding it = install `mysql2` + implement one `MySqlConnection` class.

<br /><br />

## 🏗️ Project Structure

```
selectstar/
├── prisma/
│   └── schema.prisma              # Session, Message, CanvasObject, AuditLog
├── scripts/
│   └── seed-demo.ts               # seeds db/demo.db with e-commerce data
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── connect/route.ts        # POST — open + ping + introspect
│   │   │   ├── chat/route.ts           # POST — SSE stream (the agent turn)
│   │   │   ├── confirm-write/route.ts  # POST — resolve a pending write
│   │   │   ├── refresh-schema/route.ts # POST — re-introspect
│   │   │   ├── sessions/route.ts       # GET — list recent sessions
│   │   │   ├── sessions/[id]/route.ts  # GET/PATCH/DELETE a session
│   │   │   ├── audit/route.ts          # GET — audit log for a session
│   │   │   └── suggest/route.ts        # GET — suggested starter questions
│   │   ├── layout.tsx
│   │   └── page.tsx                    # decides: ConnectionScreen or AppShell
│   ├── components/
│   │   ├── logo.tsx                    # the [S*] SVG mark
│   │   ├── connection-screen.tsx       # landing page (split-screen hero)
│   │   ├── app-shell.tsx               # top bar + resizable two-pane layout
│   │   ├── chat-pane.tsx               # chat with streaming, regenerate, stop
│   │   ├── canvas-pane.tsx             # canvas with clear + scroll-to-bottom
│   │   ├── theme-provider.tsx
│   │   ├── theme-toggle.tsx
│   │   └── canvas/
│   │       ├── canvas-object.tsx       # dispatcher
│   │       ├── canvas-table.tsx        # table + CSV export
│   │       ├── canvas-chart.tsx        # Vega-Lite + SVG/PNG export
│   │       ├── canvas-sql.tsx          # SQL + copy button
│   │       ├── canvas-eda.tsx          # stats + null-percentage bars
│   │       ├── canvas-model.tsx        # ML metrics + predictions
│   │       ├── canvas-pending-write.tsx# confirm / dry-run / cancel
│   │       └── canvas-error.tsx
│   └── lib/
│       ├── types.ts                    # CanvasObject union, AgentState, StreamEvent
│       ├── llm.ts                      # shared LLM wrapper (complete/Json/Stream + retry)
│       ├── db-connection.ts            # DbConnection interface + SQLite/Postgres impls
│       ├── frame-cache.ts              # in-memory dataframe cache
│       ├── pending-writes.ts           # Zen-mode write registry
│       ├── session.ts                  # Prisma session/message/canvas persistence
│       ├── store.ts                    # Zustand client store
│       ├── chat-client.ts             # SSE stream reader
│       └── agents/
│           ├── orchestrator.ts         # the graph (runTurn)
│           ├── router.ts               # classifies intent
│           ├── schema.ts               # answers schema questions
│           ├── sql.ts                  # writes & executes SQL (Zen-gated)
│           ├── eda.ts                  # statistical profiling
│           ├── viz.ts                  # Vega-Lite spec generation
│           ├── ml.ts                   # OLS / k-means / forecast
│           ├── synthesis.ts            # writes the final reply (streamed)
│           └── schema-utils.ts         # relevance filtering + suggested questions
└── package.json
```

<br /><br />

## 🧩 The Tech Stack

### Core framework
- **[Next.js 16](https://nextjs.org)** (App Router, Turbopack) — API routes + React frontend in one process
- **[TypeScript 5](https://www.typescriptlang.org)** — end-to-end type safety, shared types between backend & frontend
- **[React 19](https://react.dev)**

### AI / LLM
- **[z-ai-web-dev-sdk](https://www.npmjs.com/package/z-ai-web-dev-sdk)** — OpenAI-compatible client, used via one shared wrapper (`src/lib/llm.ts`). Swappable for OpenAI, vLLM, Ollama, or LM Studio by changing one file.
- **Custom TypeScript agent orchestrator** — the LangGraph-equivalent graph with conditional edges and shared `AgentState`

### Database connection layer
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** — fast synchronous SQLite driver for Node
- **[pg](https://node-postgres.com/)** — PostgreSQL client with connection pooling
- **`DbConnection` interface** — dialect-pluggable abstraction (introspection, query, executeWrite, ping, detectCanWrite)

### App database
- **[Prisma 6](https://prisma.io)** + **SQLite** — stores sessions, messages, canvas objects, and the write-audit log

### Charts
- **[Vega-Lite](https://vega.github.io/vega-lite/)** + **[react-vega](https://github.com/vega/react-vega)** — the viz agent emits declarative JSON specs; the canvas renders them as SVG. No executable plotting code ever runs (a deliberate safety choice).

### ML / stats (pure TypeScript, no Python)
- Hand-rolled **ordinary least-squares regression** (normal equations + Gaussian elimination)
- **k-means clustering** with k-means++ initialization
- **Linear-trend forecasting** with R² and slope metrics
- No scikit-learn, no Python runtime — everything runs in the Node process

### Frontend / UI
- **[Tailwind CSS 4](https://tailwindcss.com)** with a deep-teal accent and full light/dark theme via CSS variables
- **[shadcn/ui](https://ui.shadcn.com/)** (New York style) — the full component set, built on Radix UI primitives
- **[lucide-react](https://lucide.dev)** for icons
- **[framer-motion](https://www.framer.com/motion/)** for animations (staggered entrances, streaming caret, canvas transitions)
- **[react-resizable-panels](https://github.com/bvaughn/react-resizable-panels)** — the draggable two-pane chat/canvas split
- **[react-markdown](https://github.com/remarkjs/react-markdown)** for agent replies
- **[react-syntax-highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter)** (Prism) for SQL highlighting
- **[Zustand](https://zustand.docs.pmnd.rs)** for client state
- **[next-themes](https://github.com/pacocoursey/next-themes)** for dark/light mode
- **[Sonner](https://sonner.emilkowal.ski/)** for toast notifications

### Real-time
- **Server-Sent Events (SSE)** — simpler than WebSockets for one-directional agent-to-UI streaming

<br /><br />

## 🔌 API Reference

| Method | Endpoint | Purpose |
| ------ | -------- | ------- |
| `POST` | `/api/connect` | Open + ping + introspect a database. Returns schema, write-privilege, suggested questions. |
| `POST` | `/api/chat` | Run one agent turn. Returns an SSE stream of `step` / `sql` / `canvas` / `token` / `reply_done` / `done` events. |
| `POST` | `/api/confirm-write` | Resolve a pending write (`confirm` / `rollback` / `cancel`). |
| `POST` | `/api/refresh-schema` | Re-run introspection (after a DDL change in Zen mode). |
| `GET` | `/api/sessions` | List recent sessions. |
| `GET` | `/api/sessions/:id` | Load a session (state + messages + canvas history + audit log). |
| `PATCH` | `/api/sessions/:id` | Update a session (toggle Zen mode, rename). |
| `DELETE` | `/api/sessions/:id` | Close the connection + delete the session. |
| `GET` | `/api/audit?sessionId=...` | Get the write-audit trail for a session. |
| `GET` | `/api/suggest?sessionId=...` | Get suggested starter questions from the schema. |

<br /><br />

## 🧪 Scripts

```bash
bun run dev          # start the dev server (port 3000, with --hot reload)
bun run lint         # run ESLint
bun run db:push      # push the Prisma schema to the app SQLite database
bun run db:generate  # regenerate the Prisma client
bun run scripts/seed-demo.ts   # seed the demo e-commerce database
```

<br /><br />

## 🔒 Security Notes

- **Connection strings are stored in the app database** (SQLite) so sessions can be re-opened. In a real deployment, encrypt these at rest.
- **Credentials never reach the client** — the connection is opened server-side and held in an in-memory registry keyed by session id.
- **The viz path never executes code** — Vega-Lite specs are declarative JSON, validated before rendering. No `eval`, no subprocess, no matplotlib.
- **Writes are gated behind confirmation** — see Zen Mode above.
- **Schema snapshots are cached** — full introspection runs once on connect, not on every turn. Refresh explicitly via the "Refresh" button or after a DDL change.

<br /><br />

## 🎯 Design Principles

1. **Transparency over magic.** Whenever the system runs SQL, show the SQL. Whenever it builds a chart, show what data drove it. Never silently do something the user can't inspect.
2. **Read-only by default, write access is opt-in and always confirmed.** This is a hard rule.
3. **Agents are narrow and composable, not one giant prompt.** Each agent has one job, a small toolset, and a focused system prompt. The orchestrator decides which agents run, not the user.
4. **The canvas is a rendering target, not a chat message.** Chat text and canvas artifacts are two different output channels that update together but are visually and structurally separate.
5. **Everything is dialect-agnostic at the connection layer.** Postgres today, MySQL tomorrow, without rewriting agent logic.
6. **The UI should feel calm and premium, not cluttered.** Restraint (whitespace, one accent color, subtle motion) reads as "expensive."

<br /><br />

## 🤝 Contributing

We're excited you're interested in contributing to SelectStar.

### 🪲 Bugs

Find an issue on GitHub (or create a new one), add your name to it or comment that you'll be working on it. Once fixed, create a Pull Request.

### ✨ New Features

The agent architecture is intentionally composable. To add a new agent:

1. Create `src/lib/agents/your-agent.ts` exporting an async `runYourAgent(state)` that returns `{ reply, canvas }`.
2. Add the agent name to the `AgentName` type in `src/lib/types.ts`.
3. Add a routing rule in `src/lib/agents/router.ts`'s system prompt.
4. Add a node in `src/lib/agents/orchestrator.ts`'s `runTurn()`.
5. (Optional) Add a canvas-object type + renderer for structured output.

### 🎨 Canvas object types

To add a new artifact type:

1. Add it to the `CanvasObject` discriminated union in `src/lib/types.ts`.
2. Create a renderer in `src/components/canvas/canvas-your-type.tsx`.
3. Add a case to the dispatcher in `src/components/canvas/canvas-object.tsx`.

<br /><br />

## 📄 License

MIT — see [LICENSE](LICENSE).

<br /><br />

<div align="center">

**[SelectStar]** — built with Next.js · Vega-Lite · an OpenAI-compatible LLM

Agentic data analysis, in TypeScript.

</div>
