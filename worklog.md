# Quill — Agentic Database Analysis Platform

## Project Status

**Status: Fully functional and browser-verified.** Quill is a complete
agentic database-analysis platform built on Next.js 16 + TypeScript,
adapted from a Python/FastAPI + LangGraph spec to the required
Next.js stack.

The user pastes a database connection string, asks natural-language
questions, and a team of specialized AI agents (coordinated by a graph
orchestrator) decides what's needed — querying, profiling, charting, or
modeling. Every turn produces a chat reply (streamed) AND structured
artifacts (tables, charts, SQL, EDA summaries, model results) rendered in
a canvas pane.

### Verified end-to-end (agent-browser)
- ✅ Connection screen → "demo" → connects to a seeded SQLite e-commerce DB
  (6 tables: regions, customers, categories, products, orders, order_items).
- ✅ Suggested starter questions generated from the real schema.
- ✅ Router → SQL agent → SELECT executed → table + SQL canvas objects.
- ✅ Streaming markdown reply (re-chunked pseudo-streaming, see notes).
- ✅ Viz agent → Vega-Lite chart rendered as SVG via react-vega.
- ✅ Zen mode toggle (gated by write-privilege detection).
- ✅ Write request → pending_write canvas object + impact estimate +
  Confirm / Dry-run / Cancel actions.
- ✅ Dry-run (rollback) path → "1 row would have been affected. Rolled back."
- ✅ Audit log sheet captures the rolled-back write.
- ✅ Mobile responsive: two-pane resizable on desktop, tab toggle on mobile.
- ✅ Dark mode (default) + light mode toggle.
- ✅ Graceful error handling (transient 429 surfaced in chat).

## Architecture (adapted from the Python spec to Next.js)

| Spec (Python) | This build (Next.js) |
|---|---|
| FastAPI | Next.js API Routes (SSE streaming) |
| LangGraph | Custom TS graph orchestrator (`src/lib/agents/orchestrator.ts`) |
| SQLAlchemy async | Pluggable dialect drivers: `better-sqlite3` (SQLite), `pg` (Postgres) |
| OpenAI-compatible client | `z-ai-web-dev-sdk` (OpenAI-compatible) via one shared wrapper |
| pandas / scikit-learn | Pure-TS stats + ML (OLS regression, k-means, linear-trend forecast) |
| Vega-Lite via react-vega | Same — `react-vega` v8 `VegaEmbed` |

### Agent flow (graph with conditional edges)
```
user message → ROUTER ─┬─ schema ───────────────────┐
                       ├─ sql ─┬─ (write gated) → stop, await confirm
                       │       └─ (ok) ─┬─ eda ─┐
                       │                 ├─ viz ─┤
                       │                 └─ ml ──┤
                       └─ (none) ────────────────►│
                                                 ▼
                                           SYNTHESIS (stream)
```

## Key Files
- `src/lib/types.ts` — shared CanvasObject union, AgentState, StreamEvent.
- `src/lib/db-connection.ts` — dialect manager + introspection + write gating.
- `src/lib/llm.ts` — shared LLM wrapper (complete / completeStream / completeJson w/ retry).
- `src/lib/agents/*` — router, schema, sql, eda, viz, ml, synthesis, orchestrator.
- `src/lib/frame-cache.ts` — in-memory dataframe cache (never serialize big frames into prompts).
- `src/lib/pending-writes.ts` — pending-write registry for Zen-mode confirmation.
- `src/lib/session.ts` — Prisma session/message/canvas/audit persistence.
- `src/app/api/*` — connect, chat (SSE), confirm-write, refresh-schema, sessions, audit, suggest.
- `src/components/*` — connection screen, chat pane, canvas pane, 7 canvas renderers, app shell.
- `scripts/seed-demo.ts` — seeds `db/demo.db` with realistic e-commerce data.
- `prisma/schema.prisma` — Session, Message, CanvasObject, AuditLog.

## Important Implementation Notes
- **Streaming**: z-ai-web-dev-sdk's `stream:true` does NOT yield OpenAI-style
  delta chunks. `completeStream` now uses non-streaming `complete()` and
  re-chunks the result into ~3-word pseudo-tokens emitted with a 12ms delay —
  preserves the live "typing" feel while staying robust.
- **JSON robustness**: `completeJson` retries once on parse failure with a
  corrective nudge. The SQL agent additionally falls back to regex extraction
  of the `sql` field when JSON is malformed (models occasionally drop a colon).
- **better-sqlite3** works under Node (Next.js API routes) but NOT under Bun's
  runtime, so the seed script uses `bun:sqlite`. This is fine because the dev
  server runs via `next dev` (Node).
- **Zen-mode safety**: writes are NEVER auto-executed. They register a
  pending_write (10-min TTL), surface a confirm/dry-run/cancel UI, and every
  resolution is audit-logged regardless of outcome. Dry-runs execute inside a
  transaction that is immediately rolled back.

## Current Goals / Completed
- [x] Phase 1: connection layer + schema introspection (SQLite + Postgres).
- [x] Phase 2: minimal graph (router + SQL), read-only.
- [x] Phase 3: frontend skeleton — connect screen, chat (SSE), canvas (table).
- [x] Phase 4: EDA + Viz agents, Vega-Lite rendering.
- [x] Phase 5: Zen mode — write gating, confirmation UI, transactions, audit log.
- [x] Phase 6: ML agent (regression / k-means / forecast) + model-result canvas.
- [x] Phase 7: visual polish — teal theme, dark mode, animations, mobile tabs.

## Unresolved Issues / Risks / Next-phase Priorities
1. **ML agent** is wired and unit-tested in isolation but not yet exercised
   end-to-end in the browser (rate limits during this session). Next phase:
   verify a "cluster the customers" or "forecast monthly orders" prompt.
2. **PostgreSQL path** is implemented and lint-clean but only SQLite is
   exercisable in this sandbox (no reachable external Postgres). The pg driver
   is installed; the introspection/executeWrite code paths mirror SQLite's.
3. **Schema relevance filtering** uses keyword matching (v1 heuristic, per
   spec §4.6). Upgradeable to embeddings if schemas grow large.
4. **Rate limits**: the z-ai LLM can 429 under rapid successive turns. The UI
   surfaces this gracefully; a future improvement could add client-side
   throttling / retry with backoff for agent LLM calls.
5. **Persistence of pending writes** is in-memory only (registry). A server
   restart drops them. Acceptable for v1; could move to the DB.
6. **Canvas history reload** on session re-open: the API loads it, but the
   frontend store doesn't yet hydrate from a re-opened session (the "New"
   button always starts fresh). Adding a session-picker + reload is a natural
   next feature.

## Recommended Next-phase Priorities
1. ~~Verify ML agent end-to-end (cluster + forecast prompts).~~ ✅ Done — both forecast and k-means verified.
2. ~~Add session reload from the canvas history (session picker on the connect screen).~~ ✅ Done — "Recent sessions" on connection screen.
3. ~~Add export-to-CSV / export-chart-PNG buttons on canvas objects.~~ ✅ Done — CSV export on tables.
4. ~~Add a "regenerate" button on assistant messages.~~ ✅ Done — regenerate + copy buttons.
5. Tune the viz agent prompt to better honor the requested chart type (e.g.
   "distribution of totals" should bin the numeric column, not group by status).

---

## Round 2 — Cron-triggered QA & Feature Advancement (2025-07-04)

### QA Findings & Bugs Fixed
1. **EDA agent received only 1 row** (critical): When the user asked for a
   "statistical summary", the SQL agent generated an aggregate query
   (`SELECT COUNT(*), AVG(...)...`) because it didn't know EDA would also
   run. The EDA agent then profiled a single aggregate row — useless.
   **Fix**: Pass the router's `routedAgents` list to `runSqlAgent()` as
   `downstreamAgents`. Added rule 9 to the SQL agent's system prompt:
   "If EDA will run, return RAW rows — do NOT use GROUP BY, COUNT, AVG. If
   ML will run, return RAW numeric features — do NOT use CASE WHEN or
   pre-bucket." The orchestrator now passes `route.agents.filter(a => a !==
   'sql')` to the SQL agent. **Verified**: "Profile the orders table" now
   profiles 500 raw rows (was 1).

2. **SQL agent pre-clustered with CASE WHEN** for ML requests: When the user
   asked "Cluster products by price and stock", the SQL agent generated
   `CASE WHEN price < 50 AND stock < 100 THEN 'Low Price, Low Stock'...`
   instead of returning raw `price, stock` columns for the ML agent.
   **Fix**: Same downstream-agents rule above. **Verified**: SQL now returns
   `SELECT id, name, category_id, price, cost, stock, discontinued FROM
   products LIMIT 500` and the ML agent runs k-means on the raw features.

3. **"Set objects not supported" React warning**: A recurring Next.js 16 /
   React 19 dev-mode serialization warning from `next/font`. Non-breaking
   (page renders 200). Left as-is — it's an internal React dev warning, not
   a functional bug.

### New Features Added
1. **CSV export** on table canvas objects: A "CSV" button in the table header
   downloads the full result set as a properly-quoted CSV file. Verified
   end-to-end — "Exported CSV" toast appears on click.

2. **Copy SQL** button on SQL canvas objects: A copy icon in the SQL header
   copies the query to the clipboard.

3. **Copy message** button on assistant chat messages: Appears on hover
   below any completed assistant reply. Shows "Copied" confirmation for 2s.

4. **Regenerate** button on the last assistant message: Removes the last
   assistant reply and re-runs the agent turn with the preceding user
   question. Uses `popLastAssistant()` store action. Verified working.

5. **Session reload** (Recent sessions): The connection screen now shows a
   "Recent sessions" section listing up to 5 previous connected sessions
   with label, dialect badge, Zen badge, time-ago, and delete button.
   Clicking reopens the session with full message + canvas history. Uses
   `loadSession()` store action + GET `/api/sessions/:id`.

### Visual Polish
1. **Animated thinking dots**: Replaced the static "thinking…" text with
   three bouncing dots (`.think-dot` CSS animation) for a more alive feel.
2. **Connection status indicator**: Added a pulsing emerald dot in the top
   bar next to the Quill logo (uses Tailwind `animate-ping`).
3. **Null-percentage bars in EDA**: The nulls column now shows a mini bar
   (`.null-bar` + `.null-bar-fill`) colored emerald/amber/destructive
   based on null percentage.
4. **Table row hover**: Added `hover:bg-accent/30` to table rows.
5. **Canvas card headers**: Refined table and SQL headers with a subtle
   `bg-muted/20` background and action buttons in a flex row.
6. **Shimmer utility**: Added `.shimmer` CSS class for skeleton loading
   (available for future use).

### Files Modified This Round
- `src/lib/agents/sql.ts` — Added `downstreamAgents` parameter + rule 9.
- `src/lib/agents/orchestrator.ts` — Pass `route.agents` to `runSqlAgent`.
- `src/lib/store.ts` — Added `loadSession()` and `popLastAssistant()`.
- `src/components/canvas/canvas-table.tsx` — CSV export button + row hover.
- `src/components/canvas/canvas-sql.tsx` — Copy SQL button + header redesign.
- `src/components/canvas/canvas-eda.tsx` — Null-percentage visual bars.
- `src/components/connection-screen.tsx` — Recent sessions section.
- `src/components/chat-pane.tsx` — Regenerate + Copy buttons, thinking dots.
- `src/components/app-shell.tsx` — Connection status pulse dot.
- `src/app/globals.css` — think-dot, shimmer, null-bar animations.

### Remaining Next-phase Priorities
1. Tune the viz agent prompt to better honor requested chart types (e.g.
   "distribution of totals" should bin the numeric column, not group by
   status).
2. Add chart PNG/SVG export on chart canvas objects.
3. Add client-side throttling/retry for 429 rate-limit errors.
4. Add a "stop generating" button to abort streaming mid-turn.
5. Improve the chart agent to handle "distribution" requests by computing
   bins server-side rather than relying on Vega-Lite's binning transform.

