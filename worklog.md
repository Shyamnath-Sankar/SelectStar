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
1. ~~Tune the viz agent prompt to better honor requested chart types.~~ ✅ Done — router now routes "distribution" to viz+eda; viz agent has histogram rule; smart fallback bins numeric columns.
2. ~~Add chart PNG/SVG export on chart canvas objects.~~ ✅ Done — SVG + PNG export buttons on every chart.
3. ~~Add client-side throttling/retry for 429 rate-limit errors.~~ ✅ Done — `complete()` retries 3× with exponential backoff on 429/transient errors.
4. ~~Add a "stop generating" button to abort streaming mid-turn.~~ ✅ Done — AbortController + red Stop button replaces Send while streaming.
5. Improve the chart agent to handle "distribution" requests by computing bins server-side (currently relies on Vega-Lite's binning transform — works fine).

---

## Round 4 — PostgreSQL Connection Fix + Landing Page Redesign (2025-07-05)

### Critical Bug Fixed: PostgreSQL Connection
**User reported**: `Could not reach the database host. getaddrinfo ENOTFOUND host`
when connecting to `postgresql://reader:...@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs`.

**Root cause**: Two bugs, not one:
1. The FK introspection SQL referenced `ccu.foreign_table_name` /
   `ccu.foreign_column_name`, which **don't exist** in
   `information_schema.constraint_column_usage` — that view has `table_name`
   / `column_name`. The introspection threw a SQL error.
2. The connect route caught **both** connection errors AND introspection
   errors in one `try` block, then ran them all through
   `friendlyConnectionError()` — so a SQL introspection failure got
   mislabeled as "Could not reach the database host."

**Fix** (3 parts):
- Fixed the FK query: `ccu.table_name AS ref_table, ccu.column_name AS ref_column`,
  and added `tc.table_schema=ccu.constraint_schema` to the JOIN for correctness.
- Added a `ping()` method to the `DbConnection` interface (SQLite: `SELECT 1`;
  Postgres: `pool.connect()` + `SELECT 1`). pg's Pool is lazy — the constructor
  never throws, so this is where DNS/auth/TLS/port errors actually surface.
- Split the connect route into Phase 1 (open + ping → connection errors) and
  Phase 2 (introspect → SQL errors), each with its own clear error message.
  Introspection errors now say "Connected to the database, but couldn't read
  its schema: <real SQL error>" instead of pretending the host was unreachable.
- Added `connectionTimeoutMillis: 10000` to the pg Pool so unreachable hosts
  fail fast instead of hanging.
- Added `SET LOCAL statement_timeout = '3s'` before each per-table COUNT(*)
  so one slow table on a remote database doesn't block the whole introspection
  (the RNAcentral DB at EBI was taking 90s; now it's bounded).
- Made per-table PK/FK/COUNT queries best-effort (try/catch) so a permission
  denial on one table doesn't kill the whole introspection.

**Verified**: The real external PostgreSQL database (RNAcentral at EBI) now
connects successfully — the fix is confirmed end-to-end.

### Landing Page Redesigned (best-in-class)
Completely rebuilt the connection screen as a premium split-screen layout:
- **Left panel (desktop)**: Hero with "Talk to your database in plain English"
  headline, an integrated agent-pipeline visualization card showing
  Router→SQL→{EDA,Viz,ML}→Reply with animated badges and connectors, and
  three color-accented feature rows (emerald/primary/amber).
- **Right panel**: Connection form with monospace input, 3 quick-start
  options (Demo/PostgreSQL/SQLite), full-width Connect button, inline
  error states, and a "Recent sessions" list with DB-icon avatars, dialect
  badges, time-ago, and hover-to-delete.
- **Ambient backdrop**: Three blurred gradient blobs (primary + emerald) +
  a subtle 48px grid pattern at low opacity.
- **Mobile**: Stacks to a single column with the hero condensed and feature
  rows below the form.
- **Animations**: Framer Motion staggered entrance for the logo, headline,
  pipeline card, and feature rows. Agent badges scale in with a cascade.
  Recent-session rows slide right on hover.

### VLM Design Review
Used the VLM skill to iteratively evaluate the landing page screenshot:
- Round 1: 7/10 — "agent team feels disconnected", "recent sessions lack hierarchy"
- Round 2: 6/10 — "cramped spacing", "pipeline icons too small"
- Round 3: 7/10 — "improved", remaining feedback was marketing-site concerns
  (social proof) that don't apply to a tool's connect screen.

### Files Modified This Round
- `src/lib/db-connection.ts` — Fixed FK introspection SQL; added `ping()`;
  per-table best-effort queries; `statement_timeout`; `connectionTimeoutMillis`.
- `src/app/api/connect/route.ts` — Split into Phase 1 (ping) + Phase 2
  (introspect) with distinct error messages.
- `src/components/connection-screen.tsx` — Complete redesign: split-screen
  hero, agent pipeline card, color-accented features, improved recent sessions.

### Remaining Next-phase Priorities
1. The "Set objects not supported" React dev warning (from next/font) —
   cosmetic only, page renders 200. Low priority.
2. Add a "new connection" flow from inside the app (currently must click
   "New" which returns to the landing page).
3. Consider adding a schema-search box in the Schema sheet for databases
   with many tables.
4. The chart agent could compute histogram bins server-side for more
   control over bin count/edges.



---

## Round 5 — Rename to SelectStar + Professional README (2025-07-05)

### Product Renamed: Quill → SelectStar
- Created `src/components/logo.tsx` — an inline SVG `[S*]` logo mark (rounded
  primary-color square, white "S" stroke, white star/asterisk accent).
- Replaced "Quill" → "SelectStar" everywhere: `layout.tsx` metadata/title,
  `app-shell.tsx` top-bar wordmark, `connection-screen.tsx` desktop + mobile
  hero. All logo instances now use the `Logo` component.
- Verified in browser: tab title is "SelectStar — Agentic Database Analysis",
  logo SVG renders with alt text, wordmark shows "SelectStar".

### Professional README with Real Screenshots
Captured 10 real screenshots of the working demo at 1440px width:
1. Landing page (split-screen hero + agent pipeline)
2. Empty session with suggested questions
3. SQL agent query result
4. Viz agent bar chart
5. EDA agent statistical summary
6. ML agent k-means clustering
7. Schema browser sheet
8. Zen mode enabled
9. Pending write confirmation UI
10. Audit log sheet

Wrote an ultra-detailed `README.md` in the Leantime style including:
- Centered logo + badges + hero screenshot
- Feature table (Agent Pipeline / Safety / Canvas / Connectivity)
- Full screenshots gallery (5 rows × 2 columns)
- **"How It Works — Agentic Orchestration Without Python"** section that
  directly answers the Python/LangGraph/FastAPI question with a concept
  mapping table and the orchestrator graph diagram + code excerpt
- The six agents explained in a table
- SSE streaming explanation with real event examples
- Zen Mode safety section
- Canvas discriminated-union type definition
- System requirements
- Installation & quick start (5 steps)
- Connecting to SQLite/PostgreSQL/MySQL
- Full project structure tree
- Complete tech stack with links
- API reference table (10 endpoints)
- Scripts reference
- Security notes
- Design principles
- Contributing guide (how to add an agent / canvas type)
- MIT license

### Files Modified This Round
- `src/components/logo.tsx` — NEW: the `[S*]` SVG logo + `LogoLockup`.
- `src/app/layout.tsx` — title/authors → SelectStar.
- `src/components/app-shell.tsx` — top bar uses `Logo` + "SelectStar".
- `src/components/connection-screen.tsx` — hero uses `Logo` + "SelectStar".
- `public/screenshots/*.png` — 10 real demo screenshots + logo SVG.
- `README.md` — NEW: comprehensive professional README.

---

## Round 6 — Light-theme screenshots + README cleanup (2025-07-05)

### Light-theme screenshots (dev tools badge hidden)
- Switched the app to light theme via `document.documentElement.classList.remove('dark')`.
- Hid the Next.js dev-tools badge / issues overlay before every screenshot using
  `agent-browser eval` (set `display:none` on the badge buttons).
- Re-captured 4 clean light-themed screenshots at 1440px:
  1. `01-landing.png` — landing page (split-screen hero)
  2. `03-sql-query.png` — SQL agent query result
  3. `04-chart.png` — viz agent bar chart
  4. `06-ml-clustering.png` — ML agent k-means clustering
- Deleted the 6 old dark-themed screenshots no longer used.
- VLM-verified: all 4 are light theme, no dev-tools badges in corners.

### README cleanup per user request
- **Screenshots gallery**: reduced from 10 images to 4 (2×2 grid).
- **Mapping table**: removed the "Concept in the spec (Python)" column — now
  a 2-column table (SelectStar implementation | why it's equivalent).
- **Code blocks**: removed the `AgentState` type definition and the
  `runTurn()` code excerpt from the "How It Works" section. Only the ASCII
  graph diagram remains (it's a visual, not code).
- **"Streaming without WebSockets" section**: removed entirely.
- **"The Canvas Concept" section**: removed entirely (the discriminated-union
  type definition).
- **Project Structure**: moved UP — now appears right after the screenshots,
  above "How It Works", "Zen Mode", and "System Requirements".

### Files Modified This Round
- `public/screenshots/*.png` — 4 fresh light-theme screenshots (old dark ones removed).
- `README.md` — rewritten per the cleanup instructions above.
