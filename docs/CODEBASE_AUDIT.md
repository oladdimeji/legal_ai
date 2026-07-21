# Legal AI Codebase Audit

**Audit date:** 2026-07-21  
**Scope:** Baseline repository audit before the compact upgrade  
**Change policy:** This document is the only repository change. No application code, schema, configuration, dependency, or behavior was changed.

## Executive Summary

The repository is a compact React 19 single-page application served by one Express 4 process. PostgreSQL/Supabase with pgvector stores firms, users, cases, documents and chunks, case-document links, conversation threads/messages, and drafts. Gemini supplies embeddings, prompt improvement, chat, research decomposition/summarization, draft generation, and optional Google Search grounding. Two apparent legal-source connectors return local hardcoded results rather than querying their named services.

The current application is a single-tenant prototype, not an authenticated or isolated multi-user system. There is no authentication middleware, session model, login gate, workspace context, or ownership-aware query layer. `GET /api/me` selects the first firm and first user. Most reads, writes, updates, and deletes accept global IDs and do not verify user, firm, case, thread, or draft ownership. The `wide` search path searches all document chunks, including case-owned documents, so General Assistant and Wide Library can expose Matter material. These issues must be fixed before navigation or feature expansion.

## Repository Architecture

| Layer | Files | Current role |
| --- | --- | --- |
| React entry and view switcher | `src/main.tsx`, `src/App.tsx` | Mounts the SPA; keeps global view, active case, active thread, profile labels, and sidebar state in React state. No URL router is used. |
| React views/components | `src/components/Sidebar.tsx`, `AssistantView.tsx`, `WorkspaceView.tsx`, `DraftEditorView.tsx`, `HistoryView.tsx` | Four top-level views plus the shared sidebar. Styling is inline Tailwind utility classes with a white/black/grayscale base. |
| Shared types | `src/types.ts` | Defines User, Firm, Case, Document, DocumentChunk, Thread, Message, Draft, Citation, and related shapes. |
| Express application | `server.ts` | Starts schema/preseed work, exposes all APIs, orchestrates retrieval and Gemini, produces DOCX files, and serves Vite or production assets. |
| Database service | `server/db.ts` | Lazily opens a PostgreSQL pool, automatically creates/alters schema, seeds prototype records, embeds documents, and contains every SQL query. |
| AI layer | `server/model.ts` | Lazy Gemini client, model selection, embedding/text generation, Google Search option, retries, and error sanitization. |
| Legal connectors | `server/connectors/courtlistener.ts`, `server/connectors/govinfo.ts` | Adapter-shaped simulated data sources with keyword-selected hardcoded citations. |
| Build/runtime | `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.env.example` | Vite frontend build plus esbuild CommonJS server bundle; `npm run lint` is `tsc --noEmit`. |

There are no route modules, controllers, authentication modules, migration files, test framework, or repository/data-access abstractions beyond the single `DatabaseService`. `test-backend-rewrite.ts` is a standalone console script for citation-tag rewriting, not an automated test suite.

## Frontend Navigation and View Switching

`src/App.tsx` is the navigation controller. It initializes `activeTab` to `assistant` and conditionally renders views; there is no React Router, browser-route state, protected-route layer, or direct-link support.

| Sidebar item | State ID | Rendered view | Notes |
| --- | --- | --- | --- |
| Legal Assistant | `assistant` | `AssistantView` | Clicking it clears `activeThreadId`, returns to Assistant, and expands the sidebar. The sidebar auto-collapses once messages exist. |
| Workspace & Library | `workspace` | `WorkspaceView` | Combines the Wide Library, Case list, Case creation, Case document repository, search, preview, upload, and delete. |
| Drafts & Documents | `drafts` | `DraftEditorView` | Global draft index, optionally filtered by the globally selected `activeCaseId`. A generated draft navigates here via `initialDraftId`. |
| History | `history` | `HistoryView` | Globally fetches all threads. Selecting a card sets only `activeThreadId`, returns to Assistant, and collapses the sidebar. |

Global `activeCaseId` is shared across Assistant, Workspace, and Drafts. History does **not** restore it when a thread is opened. Consequently, a Case thread selected while another Case or Wide scope is active can show messages for one thread while the visible context selector and document list represent another scope. Subsequent messages still use the server-side thread's `case_id`, but the UI context is misleading and new-thread/list state can be mixed.

Profile defaults are rendered before `/api/me` completes: `firmName = "Sterling & Croft LLP"` and `userName = "Counsel"`. The sidebar adds further display fallbacks (`Sterling & Croft LLP`, `Counsel`, and initial `U`).

## React Views and Major Reusable Components

### `App`

- Fetches `/api/me` and `/api/cases` on mount.
- Owns active tab, active case, active thread, generated-draft handoff, user/firm display labels, and sidebar collapse state.
- Performs conditional view switching without URL routing or authentication.

### `Sidebar`

- Shared collapsible global navigation and account-label footer.
- Shows firm and user display names only; there is no email, settings view, account action, or logout.

### `AssistantView`

- Lists threads for the selected Wide/Case scope and loads a selected thread's messages.
- Provides a Wide Library/Case selector, ask bar, prompt improvement, optional deep research, workspace document picker, local-file picker, simulated Drive picker, Google Search grounding toggle, and CourtListener/GovInfo toggles.
- Renders Markdown answers, unified citations, hover/detail citation panels, deep-research steps (`CollapsibleSteps` is the only separately declared subcomponent), follow-up suggestions, copy/export/feedback/rewrite controls, and a docked response editor.
- Generates memo/email/summary drafts and redirects to the global draft editor.
- Local and selected-workspace “attachments” are display-only: their IDs/content are not sent with the message request. Local file bytes are never uploaded. Feedback is local state only. Follow-up suggestions are hardcoded keyword rules.

### `WorkspaceView`

- Combines a Case sidebar and default Wide Library with document lists, section browsing, semantic or client-side keyword search, preview, upload/index, deletion, and Case creation.
- Case creation triggers server-side Wide semantic matching and links up to three matching document chunks/documents.
- The upload form accepts pasted text rather than processing an actual uploaded file. The Drive OAuth UI is simulated and injects a hardcoded partnership agreement plus a fabricated `drive_id`.

### `DraftEditorView`

- Fetches a Case-filtered or global draft list, then automatically selects `drafts[0]` when possible.
- Loads a draft directly by supplied ID; edits and saves content; exports DOCX.
- Provides Markdown-oriented formatting controls, clipboard actions, local undo/redo, editor/preview modes, alignment state, and simulated change-tracking/version controls.
- Titles are displayed but cannot be persisted. “V1” and “V2” are hardcoded sample content, not stored versions. Show Edits fabricates one replacement in preview. Format Painter only displays an alert/state.

### `HistoryView`

- Fetches all threads, sorts and groups them client-side by recency (Today, Yesterday, This Week, Older), labels them using the client-fetched Case list, opens, and deletes them.
- It does not group by General versus Matter as the target plan requires, and opening a thread does not restore its Case context.

## Express API Route Inventory

No `/api` route requires authentication. No route derives a user or workspace from a request session.

| Method and path | Behavior | Ownership/isolation status |
| --- | --- | --- |
| `GET /api/health` | Returns status and time. | Public; appropriate for a health endpoint. |
| `GET /api/me` | Returns `db.getUser()` and `db.getFirm()`. | Public; selects unrelated first rows independently. |
| `POST /api/improve-prompt` | Sends supplied prompt to Gemini. | Public; no ownership data, rate/access control, or size limit. |
| `GET /api/cases` | Returns every Case. | Global unscoped read. |
| `POST /api/cases` | Creates a Case under the first firm and auto-links Wide search results. | Trusts implicit first firm; no authenticated owner. |
| `GET /api/documents?caseId=` | Returns all documents when absent/`null`, or documents owned/linked to supplied Case. | Supplied Case ID is not checked; Wide returns Matter documents too. |
| `POST /api/documents` | Creates and embeds pasted text under supplied `caseId`. | Supplied Case ID is not checked; first firm is assigned. |
| `DELETE /api/documents/:id` | Deletes document; chunk and junction cascades apply. | Global direct-ID delete. |
| `GET /api/threads?caseId=` | Returns all threads or those with supplied Case ID. | Global/unverified read; `null` returns all scopes rather than General only. |
| `POST /api/threads` | Creates thread under first user with optional supplied Case ID. | Supplied Case ID is not checked. |
| `DELETE /api/threads/:id` | Deletes thread; messages and drafts cascade. | Global direct-ID delete. |
| `GET /api/threads/:id/messages` | Returns messages for supplied thread. | Parent thread ownership is not checked. |
| `POST /api/search` | Vector search using body `scope` (`wide` or arbitrary Case ID). | No workspace check; Wide searches all chunks; arbitrary Case IDs are accepted. |
| `POST /api/threads/:id/messages` | Loads thread by ID, stores user message, retrieves by the thread's Case/Wide scope, calls models/connectors, stores assistant message. | Thread is globally addressable. Retrieval uses its saved scope, but neither thread nor resulting documents are workspace-owned. |
| `PUT /api/messages/:id` | Replaces message content. | Global direct-ID update; parent thread is not checked. |
| `GET /api/drafts?caseId=` | Returns all drafts or supplied Case drafts. | Global/unverified read; `null` returns all Case and General drafts. |
| `GET /api/drafts/:id` | Returns draft by ID. | Global direct-ID read. |
| `POST /api/drafts` | Generates a draft from supplied thread and messages; copies thread `case_id`; creates a parallel document. | Supplied thread is globally addressable; no ownership check. |
| `PUT /api/drafts/:id` | Replaces draft content. | Global direct-ID update. The parallel document created at draft creation is not updated. |
| `GET /api/drafts/:id/export` | Exports direct-ID draft as DOCX. | Global direct-ID read/export. |
| `GET *` | Vite SPA fallback in production. | Not an API ownership control. |

## Current PostgreSQL Data Model

All IDs and timestamps are application-generated `TEXT`; timestamps are ISO strings rather than PostgreSQL timestamp types. Nullable foreign keys do not consistently use `ON DELETE` behavior.

| Table | Columns and constraints | Relationships |
| --- | --- | --- |
| `firm` | `id` PK, `name NOT NULL` | Parent of users, cases, and documents. No user-owner column. |
| `users` | `id` PK, nullable `firm_id` FK, `name`, `email` | Belongs to firm. Email is not unique or case-insensitive; no password/session fields. |
| `cases` | `id` PK, nullable `firm_id` FK, `name`, `description`, `created_at` | Belongs to firm. Referenced by documents, links, threads, drafts. |
| `documents` | `id` PK, nullable `firm_id`, nullable `case_id`, title/source/Drive/text/section/upload fields | Can directly belong to a Case; can also be linked through `case_documents`. |
| `document_chunks` | `id` PK, `document_id` FK `ON DELETE CASCADE`, text, `vector(768)` | Child of document; HNSW cosine index. No ownership columns. |
| `case_documents` | composite PK `(case_id, document_id)`; both FKs cascade | Many-to-many Case/document linking. Used for auto-attached library documents and direct Case documents. |
| `threads` | `id` PK, nullable `user_id`, nullable `case_id` cascade, `scope`, title, created | Belongs nominally to user and optionally Case. Scope is unrestricted text and can disagree with `case_id`. |
| `messages` | `id` PK, nullable `thread_id` cascade, role/content, JSONB citations/steps, created | Ownership exists only through thread. Role is unrestricted text in DB. |
| `drafts` | `id` PK, nullable `thread_id` cascade, nullable `case_id` cascade, title/content/created | Links both thread and Case but has no firm/user column and no consistency constraint between them. |

### Relationships that must be preserved

- Existing firm-to-user, firm-to-Case, and firm-to-document assignments.
- Direct Case ownership through `documents.case_id`.
- Reusable library links through `case_documents`; removing a link must not delete the source document.
- Document-to-chunk cascade and embeddings.
- Thread-to-user and thread-to-Case context.
- Message-to-thread order, citations, and research steps.
- Draft-to-thread and draft-to-Case association.
- The current generated-draft side effect that creates a document should be migrated deliberately: currently it creates a second, unlinked record identity whose content later diverges.
- Existing stable internal names (`cases`, `case_id`, `/api/cases`) should remain compatible while UI language becomes Matter.

## Automatic Schema Initialization and Startup Mutation

`db.query()` always calls `ensureSchema()`. At server startup, `db.preseedIfEmpty()` calls a query, causing schema initialization before routes are available.

Initialization performs the following automatically against the configured `SUPABASE_DB_URL`:

1. Creates the `vector` extension.
2. Creates all nine tables with `CREATE TABLE IF NOT EXISTS`.
3. Drops `document_chunks_hnsw_idx` on every fresh process initialization.
4. Attempts to alter the existing embedding column to `vector(768)` inside a `DO` block, whether or not its dimension already matches.
5. Recreates the HNSW index.
6. Ensures hardcoded `firm_123` and `user_456` exist.
7. Seeds two hardcoded Cases only when the entire `cases` table is empty.

Then preseed checks only `COUNT(*)` in `document_chunks`. If that count is zero, it deletes **all** rows from `document_chunks`, `case_documents`, and `documents` before inserting five seed documents and generating embeddings. This behavior is destructive for an existing database whose documents have no chunks or whose chunking failed. It also assigns seeded and newly created documents through the first-firm lookup. Embedding failures silently receive random normalized vectors, producing repeatable-looking but meaningless search candidates.

Schema setup is neither a versioned migration system nor transactional as a whole. Partial success can leave schema/data changes even if a later statement fails. Text timestamps, nullable ownership FKs, missing indexes on ownership paths, missing uniqueness/check constraints, and the automatic vector alteration are migration risks.

## Current Ownership and Authentication Model

There is no authentication. The browser is trusted to call every API, and Express does not set, read, or validate a session cookie. There are no password hashes, sessions, auth pages, protected views/routes, CSRF considerations, or per-request user/workspace objects.

The effective ownership model is “first row plus globally addressable records”:

- `db.getFirm()` runs `SELECT * FROM firm LIMIT 1` with no ordering. If no row is returned, it returns hardcoded `firm_123` without inserting it there.
- `db.getUser()` runs `SELECT * FROM users LIMIT 1` with no ordering. If no row is returned, it returns hardcoded `user_456`/`firm_123` without inserting it there.
- `createCase()` and `addDocumentInternal()` use `getFirm()`.
- `createThread()` uses `getUser()`.
- `/api/me` calls the two first-row lookups independently, so in a multi-firm database the returned user and firm need not be related.

Additional default/fallback firm/user assumptions occur in `src/App.tsx` (`Sterling & Croft LLP`, `Counsel`) and `src/components/Sidebar.tsx` (the same display fallbacks and `U`). Schema initialization hardcodes the prototype firm/user and seed Cases. `DraftEditorView` assumes the first returned draft should become active (`drafts[0]`); although not a user/firm lookup, it is relevant to cross-context draft display.

## Complete Database Query and Isolation Inventory

Every SQL statement is in `server/db.ts`.

### Schema, seed, and maintenance queries

- `CREATE EXTENSION IF NOT EXISTS vector`; table creation; index drop/create; `information_schema.columns` inspection; embedding-column alteration.
- Exact-ID checks and inserts for hardcoded default firm/user.
- Global `SELECT id FROM cases`; seed Cases only when no Case exists.
- Global chunk count. On zero: global deletes from chunks, Case links, and documents.

These run without an authenticated workspace because they execute at process startup.

### Firm and user queries

- `SELECT * FROM firm LIMIT 1`.
- `SELECT * FROM users LIMIT 1`.

Both are unordered, unscoped first-row queries.

### Matter/Case queries

- List: `SELECT * FROM cases ORDER BY created_at DESC` — all firms.
- Read: `SELECT * FROM cases WHERE id = $1` — currently unused by routes, but unscoped.
- Insert: creates under `getFirm()`; no authenticated workspace.
- Auto-link: Wide vector search, global document-by-ID reads, then junction insert with supplied/new Case and global document IDs.

### Document and document-chunk queries

- Insert document under first firm and optional frontend-supplied Case; optionally insert Case/document junction.
- Insert chunks after embedding each paragraph.
- Wide list: `SELECT * FROM documents ORDER BY uploaded_at DESC` — includes firm-level and all Case documents across firms.
- Case list: filters `d.case_id = $1 OR cd.case_id = $1` before retrieval, but does not constrain firm/workspace or validate the Case.
- Direct read: document ID only.
- Section suggestion: computes average similarity grouped across **all documents in all firms and Cases**, then uses the returned section label.
- Delete: document ID only.
- Wide vector search: searches and ranks **all chunks** with no document join or ownership/scope predicate.
- Case vector search: filters by direct or junction Case association before ranking, but has no workspace check and accepts arbitrary Case ID.

### Thread queries

- Case list: filters only by supplied `case_id`.
- Global list: all users, General, and Case threads.
- Direct read/delete: thread ID only.
- Insert: first user plus optional frontend-supplied Case; no validation that Case belongs to the user's firm.

### Message queries

- List/add by supplied thread ID; no parent ownership validation in the query.
- Update by message ID only; no join to thread/user/workspace.

### Draft queries

- Case list: supplied `case_id` only.
- Global list: all drafts from every Case/user.
- Direct read/update: draft ID only.
- Insert: accepts a thread ID and Case ID supplied by the server caller after a globally unscoped thread read. No constraint ensures draft Case equals thread Case.
- Draft generation also inserts a `documents` record under the first firm, with the draft's Case ID, but stores no foreign key between draft and document.

There are no Case update/delete routes today, no standalone message delete, and no draft delete. Document and thread delete exist and are unscoped. All query parameters are parameterized, so classic SQL injection is not the main risk; broken object-level authorization is.

## General Versus Case Retrieval

### General / Wide behavior

- The Assistant selector represents General as `wide`.
- A General thread has `case_id = NULL` and `scope = 'wide'`.
- Chat derives retrieval scope from the persisted thread: `thread.case_id || 'wide'`.
- `vectorSearch(..., 'wide')` searches every row in `document_chunks`, regardless of document `firm_id` or `case_id`.
- `/api/documents?caseId=null` returns every document, including every Case document.
- `/api/threads?caseId=null` and `/api/drafts?caseId=null` become unfiltered global lists, not General-only lists.

Therefore General Assistant can retrieve Matter-specific chunks, Matter documents appear in Wide/Firm Library, General history is mixed with Matter history, and the global draft view mixes all contexts.

### Case behavior

- Document list/search filters by direct `documents.case_id` or a `case_documents` link before returning/ranking candidates.
- Chat ignores a Case ID sent with a message and uses the stored thread's Case, which is a useful invariant.
- However the thread and Case are looked up by unscoped IDs, and the Case query has no firm boundary. Anyone able to supply another Case/thread ID can retrieve or modify its records.
- Linked Firm Library documents are not distinguished from directly owned Case documents in the Case result, which is compatible with target Sources but needs explicit link semantics in the UI/API.

## Filtering After Retrieval

- `WorkspaceView` keyword search fetches the full current document payload (including `extracted_text`) and filters title/content in the browser.
- `WorkspaceView` section browsing filters an already fetched document array in the browser.
- Semantic search results are mapped to the already fetched document array in the browser for titles/previews.
- `HistoryView` fetches all threads, then sorts and groups by date in the browser and resolves Case names from the browser's Case list.
- `DraftEditorView` fetches the current/global draft list and selects the first record in the browser.
- Server chat filters similarity (`>= 0.65`) **after** SQL has globally/Case-scoped ranked and limited candidates (2 or 3). Ownership must be applied in SQL before ranking/limiting; the threshold may remain post-query.
- Auto-attachment deduplicates documents and decides links after chunk search, but the candidate scope is Wide/global before this processing.

Client-side UI filtering is not an access-control boundary because sensitive rows and full document text have already left the server.

## Security and Isolation Risks

### Explicit cross-boundary paths

1. **One user can access another user's records:** all list endpoints are global or Case-only, and direct IDs on thread/message/draft/document endpoints have no user/workspace join. `/api/me` leaks a first user/firm publicly.
2. **General Assistant can access Matter-specific information:** General chat uses global `vectorSearch('wide')`, which includes chunks whose documents have non-null `case_id` or Case links.
3. **One Matter can retrieve another Matter's information:** a caller can supply another Case ID to documents/search/threads/drafts. A caller can also supply another Matter's thread ID to message or draft-generation routes. There is no authenticated workspace or Matter ownership validation.
4. **Matter documents can appear in Firm Library:** the no-Case document list and Wide vector search do not require `documents.case_id IS NULL` or exclude directly Matter-owned documents. The global list intentionally contains both.
5. **General conversations mix with Matter conversations:** unfiltered thread listing is used for History; `/api/threads?caseId=null` also returns all threads. History groups only by time.
6. **Drafts can disconnect from the correct Matter:** General draft listing is global; direct-ID reads can load any draft; draft Case/thread consistency is unenforced; opening History does not restore Case; generated drafts create a duplicate document that does not update when the draft changes. A General thread can generate a null-Case draft, contrary to the target requirement.
7. **Frontend IDs bypass server ownership checks:** `caseId` in document list/upload, search scope, thread list/create, and draft list; thread IDs in message list/create and draft generation; document/thread/message/draft IDs in direct read/update/delete/export. All are trusted as identifiers without ownership joins.

### Additional risks

- Public endpoints can consume Gemini quota and trigger document embedding costs.
- JSON request bodies have no explicit size limit beyond Express defaults and uploads contain user-controlled text.
- Database SSL disables certificate verification (`rejectUnauthorized: false`).
- Destructive preseed cleanup can erase documents when the chunk table is empty.
- Random-vector fallbacks silently corrupt retrieval quality and can expose arbitrary candidates.
- IDs use timestamp/random strings rather than cryptographically strong identifiers; future invitation tokens must not copy this pattern.
- Thread `scope`, foreign-key nullability, and draft thread/Case consistency are not enforced by constraints.
- Deleting a thread cascades to drafts. That is existing behavior that may be surprising once drafts become durable Work Product.

## Simulated, Hardcoded, Incomplete, and Placeholder Integrations

- `CourtListenerAdapter` and `GovInfoAdapter` make no HTTP calls. They select hardcoded citations by keywords and return a generic hardcoded result otherwise.
- Google Drive in Workspace is a timer-based OAuth simulation that fills hardcoded document text and fabricates a Drive ID.
- Google Drive attachment in Assistant randomly chooses one of three hardcoded filenames after a timer.
- Local files and workspace-document selections in Assistant only create filename chips; file bytes, document IDs, and content are not sent to the server or added to retrieval.
- Feedback buttons are local-only.
- Follow-up questions are keyword-matched hardcoded arrays.
- Draft version history, tracked edits, and format painter are simulated UI behavior, not persisted functionality.
- Draft “rewrite”/side editing updates the original message by ID; there is no version/audit history.
- Seed legal documents, prototype firm/user/Cases, profile labels, and several dates/content samples are hardcoded.
- No Client Portal, client sharing, collaborator invitation, request/response, Client Revision, Matter Intelligence, Settings, or real client-facing functionality exists.

## Existing Reusable Capabilities

- Recognizable monochrome responsive shell and collapsible sidebar.
- Case-aware global state and selector that can be renamed/made ownership-safe.
- Document metadata, direct Case ownership, and many-to-many Case/source links.
- pgvector chunking, embeddings, HNSW cosine search, semantic result display, document preview, and section browsing.
- Server-side thread-derived chat scope (once the thread itself is authorized).
- Persisted messages, citations, research steps, and Markdown rendering.
- Gemini abstraction with task-specific models, retries, sanitized errors, and optional Google Search grounding.
- Draft generation from conversation history, editable work product UI, and DOCX export.
- History opening/deletion UI and Case labels.
- Express/Vite combined development and production serving.

These should be preserved and constrained, rather than rewritten wholesale.

## Migration Risks

- Existing data must be assigned deterministically to the migrated original account; first-row selection is unsafe if multiple firms/users already exist.
- A password hash must be provisioned through a secret before auth enforcement without exposing or logging it.
- Ownership constraints/indexes must be backfilled before being made non-null/unique; existing nullable or inconsistent rows require an audit query and non-destructive remediation.
- Existing Matter-owned documents are currently visible as Wide documents. Separating them may look like data loss unless links/direct ownership are classified and counts are reconciled.
- `case_documents` currently contains both auto-attached reusable documents and redundant links for direct Case uploads. Migration must define which rows represent linked Firm Library sources.
- Draft/document duplication needs a mapping strategy; deleting or merging either record would be destructive. Preserve both until a repeatable migration links or classifies them.
- Thread deletion currently cascades drafts; changing Work Product durability needs a forward migration and behavior decision.
- Automatic schema initialization, index drop/rebuild, vector alteration, and empty-chunk cleanup must be replaced or guarded before production migrations.
- Switching to timestamp columns, UUIDs, or physical table renames would be high-risk and is not required by the plan.
- Search isolation must be expressed in SQL before vector ordering/limit; filtering retrieved results afterward is insufficient.
- Existing `scope` values and `case_id` must be reconciled so General and Matter histories do not move incorrectly.

## Recommended Implementation Sequence

Follow the plan's phase order, with isolation gates treated as prerequisites:

1. Preserve the baseline and establish a repeatable, non-destructive migration mechanism. Inventory actual deployed data before any constraint changes.
2. Add sessions/authentication and a per-request authenticated user/workspace context. Backfill the original account from a protected password secret. Remove all first-row lookups.
3. Rewrite every database method so ownership is part of SQL reads, writes, ranking, updates, deletes, and exports. Validate all parent/child IDs through the authenticated workspace.
4. Separate General/Firm Library (`case_id IS NULL`, workspace-owned) from one-Matter retrieval and repair thread/history context restoration. Test with at least two users and two Matters each.
5. Only after isolation passes, split Matters and Firm Library navigation, then add Matter core fields/Sources.
6. Move drafting into required Matter Work Product while preserving existing drafts and resolving duplicate generated documents non-destructively.
7. Add Matter Intelligence, collaboration, and the token-isolated Client Portal in later phases, each with explicit boundary tests.
8. Finish with terminology cleanup and end-to-end authorization, revocation, direct-ID, and migration tests.

## Files Likely Affected by Upgrade Phase

The following is an audit forecast, not a change set. New filenames are suggested locations; exact names may vary. Every completed future phase is also expected to update `docs/UPGRADE_PROGRESS.md` and may add phase-specific tests/migrations.

| Phase | Existing files likely affected | Likely new files |
| --- | --- | --- |
| 0 — Baseline | `README.md`, `package.json` only if a non-feature verification script is approved; otherwise documentation only | `docs/UPGRADE_PROGRESS.md`, baseline/test documentation; no application changes required |
| 1 — Authentication and ownership | `server.ts`, `server/db.ts`, `src/App.tsx`, `src/Sidebar.tsx` equivalent is actually `src/components/Sidebar.tsx`, `src/types.ts`, `.env.example` | Auth middleware/service, password/session utilities, login/signup views, repeatable migration(s), auth/ownership tests |
| 2 — Search and context isolation | `server.ts`, `server/db.ts`, `src/components/AssistantView.tsx`, `WorkspaceView.tsx`, `HistoryView.tsx`, `DraftEditorView.tsx`, `src/types.ts` | Isolation/integration tests; possibly scoped repository helpers |
| 3 — Navigation and Library separation | `src/App.tsx`, `src/components/Sidebar.tsx`, `WorkspaceView.tsx`, `src/types.ts` | `MattersView.tsx`, `FirmLibraryView.tsx` (or careful extraction equivalents) |
| 4 — Matter core | `server.ts`, `server/db.ts`, `src/App.tsx`, `src/components/AssistantView.tsx`, `src/types.ts` and new Phase 3 views | Matter workspace/Overview/Sources/create components, repeatable Matter-field/source migrations, tests |
| 5 — Assistant and History context | `src/App.tsx`, `src/components/AssistantView.tsx`, `HistoryView.tsx`, `server.ts`, `server/db.ts`, `src/types.ts` | Context grouping/restoration tests; small context selector component if extracted |
| 6 — Work Product migration | `src/App.tsx`, `src/components/Sidebar.tsx`, `AssistantView.tsx`, `DraftEditorView.tsx`, `server.ts`, `server/db.ts`, `src/types.ts` | Matter Work Product components, repeatable draft-extension/backfill migration, draft/document mapping and isolation tests |
| 7 — Matter Intelligence | `server.ts`, `server/db.ts`, `server/model.ts`, `src/types.ts`, Matter workspace/Sources views | Intelligence view/editor, repeatable intelligence tables migration, generation/source-snapshot tests |
| 8 — Collaboration | `server.ts`, `server/db.ts`, `src/types.ts`, Matter workspace and Work Product views | Collaboration view, invitation/token utilities, repeatable collaboration migrations, sharing/request/response tests |
| 9 — Client Portal | `server.ts`, `server/db.ts`, `server/model.ts`, `src/App.tsx`, `src/types.ts`, collaboration/work-product code | Token-gated portal shell, Shared Documents/Requests/Client Assistant views, portal middleware/routes, boundary tests |
| 10 — Cleanup and hardening | All touched frontend/server files, especially `src/App.tsx`, Sidebar, legacy Workspace/Draft views, `server.ts`, `server/db.ts`, `src/types.ts`, `README.md` | End-to-end/security regression tests and final migration verification tooling |

Note: the plan may warrant splitting `server.ts` and `server/db.ts` only as needed for auth, migrations, and boundary-testability. A general architecture rewrite would violate the upgrade rules.

## Open Questions and Assumptions

- Which deployed `firm` and `users` rows represent the original account if more than one already exists? The audit assumes a deterministic operator-supplied ID is required; `LIMIT 1` is unacceptable.
- Does the deployed database contain documents with no chunks? If so, current startup can delete them. This must be checked read-only before running the server against production data.
- Are any `documents.case_id` values inconsistent with `documents.firm_id` versus `cases.firm_id`, or any `case_documents` links cross-firm? A pre-migration integrity report is required.
- Should direct Matter uploads remain redundantly present in `case_documents`, or should that table mean only linked Firm Library sources going forward? The target behavior suggests the latter, but existing rows must be preserved/classified.
- Should deleting a conversation continue deleting associated drafts after drafts become Work Product? The target durability model suggests no, but the plan does not explicitly resolve the current cascade.
- How should existing null-Case drafts be assigned to a Matter? The target forbids unassigned Work Product; assignment requires an explicit, non-destructive policy or user choice.
- Should generated draft documents remain searchable Matter Sources? The target says generated Work Product must not automatically become a Source, so existing generated `documents` need identification without deletion.
- No actual database was queried during this repository-only audit. Findings describe schema/code behavior, not deployed row counts or integrity.

## Lint and Production Build Results

### `npm run lint`

**Result: FAILED before TypeScript execution.** Exit code 1.

```text
> react-example@0.0.0 lint
> tsc --noEmit

'tsc' is not recognized as an internal or external command,
operable program or batch file.
```

The repository has no local `node_modules` installation in the audited workspace. This result does not establish whether the TypeScript source itself passes or fails; the compiler executable was unavailable. Dependencies were not installed because the task prohibits dependency changes.

### `npm run build`

**Result: NOT RUN.** Repository rule 19 says not to continue past a failing lint or build command. After lint failed, the build was intentionally not invoked. With local dependencies absent, Vite/esbuild executables would also not be available. No `dist` artifact was created.

## Highest-Priority Findings

1. Authentication and server-derived workspace ownership do not exist; all records are effectively globally addressable.
2. General/Wide vector search and document listing include Matter-specific documents, directly violating the required General/Matter boundary.
3. Every direct ID route and most Case-scoped routes lack object ownership checks, enabling cross-user and cross-Matter read/update/delete/export paths.
4. Startup preseed behavior can delete all documents and links whenever `document_chunks` is empty, and schema mutation is automatic/unversioned.
5. Threads, drafts, and UI context can diverge: History does not restore Matter context, global lists mix contexts, draft thread/Case consistency is unenforced, and generated draft documents drift from edited drafts.
