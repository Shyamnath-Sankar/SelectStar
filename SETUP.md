# SelectStar

An agentic database-analysis platform. Paste a connection string, ask
questions in plain English, get tables, charts, EDA, model results, and full
narrative reports.

## Quick start (local)

```bash
# 1. Install deps
bun install

# 2. Generate the Prisma client + push the schema
bun run db:generate
bun run db:push

# 3. Seed the demo e-commerce DB (optional but recommended)
node scripts/seed-demo.js

# 4. Start the dev server
bun run dev
```

Open <http://localhost:3000> and click **Connect** (the `demo` connection
string is pre-filled).

## What this build does

- **Light theme is the default.** Use the theme toggle in the top-right
  corner to switch to dark.
- **No auto data-quality scan.** The canvas starts empty — you drive the
  analysis via chat.
- **Chat header** has just two actions:
  - **SQL** — toggle to show/hide generated SQL blocks on the canvas
    (default OFF; the canvas stays focused on results).
  - **New** — reset the session and go back to the connection screen.
- **"Include technical terms" toggle in the report plan** (default OFF):
  - **OFF (default)**: the report is plain English. No statistical jargon.
    "Correlation" → "move together", "outlier" → "unusual value",
    "cluster" → "natural group", "skew" → "lopsided", "R²"/"Pearson r"
    suppressed.
  - **ON**: the report uses proper statistical terms with brief explanations.
- **Human-in-the-loop UIs render inline in the chat**, not on the canvas:
  pending-write confirmation (Confirm / Dry-run / Cancel) and report-plan
  picker (focus / depth / sections / Include-technicals / Generate).
  The canvas is read-only analytical artifacts only (tables, charts, EDA,
  models, reports).
- **Prisma query logs silenced.** Dev console only shows HTTP summaries +
  warnings/errors.

## Connecting your own database

Replace `demo` with:
- `sqlite:./path/to/your.db` for a SQLite file
- `postgresql://user:pass@host:5432/db` for Postgres

For PostgreSQL, write privileges are detected automatically — Zen mode
becomes available if the role has `CREATE` on the database.

## LLM configuration

The `.env` file in this repo ships with a Groq API key + base URL. To use a
different OpenAI-compatible provider (OpenAI, vLLM, Ollama, LM Studio),
update `.env`:

```
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=your-key-here
LLM_MODEL=openai/gpt-oss-120b
```

## Deploy on Render

`render.yaml` is included. Either:
- Use the Render Blueprint: <https://render.com/docs/blueprint-spec> →
  "New + Blueprint" → select this repo. Render reads `render.yaml` and
  creates the service + persistent disk automatically.
- Or configure manually — the build/start commands are in `package.json`:
  - `build`: `bun install && bun run db:generate && bun run build`
  - `start`: `bun run start`

### Render env vars

Set these in the Render dashboard (or commit them in `.env` — your choice):

| Key | Value |
|---|---|
| `DATABASE_URL` | `file:/opt/render/project/src/.data/custom.db` (with Persistent Disk) **OR** Postgres connection string |
| `LLM_API_KEY` | your Groq / OpenAI key |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
| `LLM_MODEL` | `openai/gpt-oss-120b` |

### Persistent disk (required for SQLite)

If you keep SQLite, attach a 1GB persistent disk at
`/opt/render/project/src/.data`. Without it, your DB file is wiped on every
redeploy. Alternatively, switch to Render PostgreSQL (change
`prisma/schema.prisma` `provider` to `postgresql` and set `DATABASE_URL` to
the internal connection string).

## Project structure

```
src/
├─ app/
│  ├─ api/             (chat, connect, confirm-write, sessions, data-quality, classic, audit)
│  ├─ layout.tsx
│  └─ page.tsx
├─ components/
│  ├─ canvas-pane.tsx          (filters HITL + SQL when off)
│  ├─ chat-pane.tsx             (Show SQL toggle, HITL inline renderer)
│  ├─ app-shell.tsx             (no auto DQ scan)
│  ├─ theme-provider.tsx        (defaultTheme="light", enableSystem=false)
│  ├─ canvas/canvas-report-plan.tsx  (Include-technicals toggle)
│  ├─ canvas/canvas-report.tsx       (technical/plain-English badge)
│  └─ ...
├─ lib/
│  ├─ store.ts                 (showSql, inlineArtifacts)
│  ├─ session.ts               (restores inlineArtifacts on reload)
│  ├─ types.ts                 (includeTechnicals on ReportCanvasObject,
│  │                            defaultIncludeTechnicals on ReportPlan)
│  ├─ db.ts                    (log: ['warn', 'error'] only)
│  ├─ agents/report.ts         (plain-English narrator + pattern mining)
│  └─ ...
└─ ...

prisma/schema.prisma
scripts/seed-demo.js
render.yaml
Dockerfile
.env                (committed — contains LLM_API_KEY, etc.)
```
