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
1. Verify ML agent end-to-end (cluster + forecast prompts).
2. Add session reload from the canvas history (session picker on the connect screen).
3. Add export-to-CSV / export-chart-PNG buttons on canvas objects.
4. Add a "regenerate" button on assistant messages.
5. Tune the viz agent prompt to better honor the requested chart type (e.g.
   "distribution of totals" should bin the numeric column, not group by status).
