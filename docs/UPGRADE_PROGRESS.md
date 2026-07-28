# Compact Upgrade Progress

## V1 Completion Phase — Live GovInfo Traceability and Citation Validation

Status: Complete in code; staging gate remains closed.

Implemented:

- Replaced the empty GovInfo adapter with official search plus package/granule summary and text retrieval, normalized filters, bounded pagination, timeouts, retry/429 handling, cache TTL, and honest empty/outage results.
- Added normalized retrieved sources and immutable, authenticated firm/user/thread/Matter-scoped research runs with exact supporting-passage snapshots.
- Limited GovInfo citations to sources attached to the current request run and preserved provider/source identifiers, publication/retrieval dates, canonical links, and available metadata.
- Added an explicit GovInfo outage notice and removed visible CourtListener controls. CourtListener remains rejected by configuration.

Schema changes:

- Migration 015 additively creates `retrieved_legal_sources`, `research_runs`, and `research_run_sources`, indexes scoped run lookup, and adds update/delete rejection triggers for run trace rows.
- No existing rows or tables are renamed, reset, truncated, or deleted.

Dependencies added:

- None. The connector uses the Node 22 Fetch API and existing PostgreSQL driver.

Feature gate:

- `FEATURE_GOVINFO=false` remains the exact gate until the GovInfo staging checklist passes.
- `FEATURE_COURTLISTENER=false` remains disabled and hidden.

Verification:

- Pre-change `npm ci`: passed; npm reported two existing high-severity advisories.
- Pre-change `npm run verify`: passed, 103/103 tests, with the existing Vite large-chunk warning.
- Final `npm run lint`: passed.
- Final `npm test`: passed, 107/107 active tests; the environment-gated live GovInfo smoke test was skipped as designed without staging credentials.
- Final `npm run build` and `npm run verify`: passed; the existing Vite large-chunk warning remains.
- Docker build was not required for this connector phase.

Known limitations:

- GovInfo source availability and metadata vary by collection; results without retrievable official text are omitted.
- CourtListener, OCR, and Gmail sending remain deferred.

## V1 Completion Phase — Durable Async Ingestion, Worker, and ClamAV

Status: Complete in code; staging gate remains closed.

Implemented:

- Added pg-boss jobs created only after private object confirmation, with per-version singleton keys, bounded exponential retry, retention, and failed-job visibility.
- Added a separate worker with restart recovery, durable heartbeats/events, cancellation checks, scan-before-extraction, PDF/DOCX/TXT extraction, deterministic chunking, and idempotent embedding upserts.
- Added private ClamAV TCP `INSTREAM` scanning and Compose health checks.
- Added durable `uploaded`, `scanning`, `extracting`, `needs_ocr`, `indexing`, `ready`, `failed`, and `cancelled` states.
- Preserved originals for scanned/image-only PDFs and records `needs_ocr` without adding OCR behavior or controls.
- Added independent batch upload settlement so one failed file does not prevent other confirmed files from being queued.
- Added polling progress to Matter Sources and Firm Library; Matter creation hands off confirmed uploads to the same durable rows.

Schema changes:

- Migration 014 additively extends `document_versions` with processing state, scan result, job ID, attempts, safe error code, timing/heartbeat, and cancellation fields.
- Migration 014 adds append-only `ingestion_events`, chunk indexes/content hashes, a partial unique document/chunk-index constraint, and recovery/visibility indexes.
- Existing documents, versions, chunks, and retrieval predicates are preserved. No table/data reset or destructive rename is performed.

Dependencies added:

- `pg-boss` for PostgreSQL-backed durable jobs, retries, recovery, cancellation, and retained job state.

Feature gate:

- `FEATURE_ASYNC_INGESTION=false` remains the exact gate until the async-ingestion staging checklist passes.

Verification:

- Pre-change `npm ci`: passed; npm reported the two existing high-severity React Router advisories.
- Pre-change `npm run verify`: passed, 98/98 tests, with the existing Vite large-chunk warning.
- Final `npm run lint`: passed.
- Final `npm test`: passed, 103/103 tests.
- Final `npm run build`: passed for the Vite app, web server, and separate worker; the existing Vite large-chunk warning remains.
- Final `npm run verify`: passed.
- `docker compose config --quiet`: passed.
- Docker image build could not run because Docker Desktop's Linux engine pipe was unavailable at `npipe:////./pipe/dockerDesktopLinuxEngine`.

Known limitations:

- OCR, Google Document AI, CourtListener, and Gmail sending remain deferred and unavailable.
- Legacy multipart and temporary Assistant attachment extraction remain the compatibility path while the async-ingestion flag is false.
- Live Supabase, ClamAV signature, worker-restart, and PostgreSQL migration validation require staging infrastructure.

## V1 Completion Phase — Private Supabase Storage and Durable Originals

Status: Complete in code; staging gate remains closed.

Implemented:

- Added server-only Supabase Storage access with signed two-hour upload tokens and one-minute original download URLs.
- Added browser-side TUS uploads in required 6 MB resumable chunks for Matter creation, Matter Sources, and Firm Library.
- Added firm/Matter/document/version-scoped safe object keys and durable authorization/confirmation state.
- Added file, batch, workspace byte, and workspace file limits with firm-row serialization and duplicate checksum rejection.
- Required private object existence and matching size/checksum metadata before confirmation creates a compatible document record.
- Preserved existing multipart routes as the default-false compatibility path.
- Did not add a worker, OCR, CourtListener, Gmail, or Google Drive behavior.

Schema changes:

- Migration 013 adds `upload_batches` and `document_versions` with ownership, object metadata, checksum, upload source/uploader, authorization expiry, and durable state.
- Existing `documents` rows remain valid and need no backfill. Confirmed private uploads add a compatible `documents` row in `Uploaded` state.

Dependencies added:

- `@supabase/supabase-js` for server-side signed Storage operations.
- `tus-js-client` for direct browser-to-Supabase resumable uploads.

Verification:

- Pre-change `npm ci`: passed; npm reported the two existing high-severity React Router advisories.
- Pre-change `npm run verify`: passed, 92/92 tests, with the existing Vite large-chunk warning.
- Final `npm run lint`: passed.
- Final `npm test`: passed, 98/98 tests.
- Final `npm run build`: passed with the existing Vite large-chunk warning.
- Final `npm run verify`: passed.
- `docker compose config --quiet`: passed.
- Docker image build could not run because the local Docker Desktop Linux engine pipe was unavailable at `//./pipe/dockerDesktopLinuxEngine`.

Feature gate:

- `FEATURE_PRIVATE_STORAGE=false` remains the exact gate until the private-bucket staging checklist passes.

Known limitations:

- The worker is intentionally deferred; confirmed originals remain `Uploaded` and are not extracted or indexed by this phase.
- Legacy Client Portal uploads remain on the preserved multipart compatibility route.
- No live Supabase bucket or staging database was available, so migration application, TUS interruption/resume, and signed download expiry remain manual staging gates.

## V1 Completion Phase — Public/Application/Client Routing and Accessible UI Shell

Status: Complete.

Implemented:

- Added React Router incrementally with public, authenticated lawyer, reserved client-account/invitation, and legacy token route families.
- Added separate public, lawyer, and client layouts plus a responsive monochrome Exepts landing page.
- Preserved the existing Assistant, Matters, Firm Library, Matter Intelligence, Work Product, collaboration, History, Settings, authentication, and legacy Client Portal workflow components.
- Kept `/client/:token` independent of the default-false client-account gate.
- Added reusable accessible loading, empty, and error states, skip links, landmarks, active navigation semantics, and narrow-screen navigation behavior.
- Extracted the production SPA fallback into a testable helper so nested route refreshes return the built application.

Schema changes:

- None. No migration or stored-data operation was required.

Dependencies added:

- `react-router-dom` 7.18.1 for browser routing and nested route matching.

Verification:

- Pre-change `npm ci`: passed; 0 vulnerabilities.
- Pre-change `npm run verify`: passed with 89/89 tests and the existing Vite large-chunk warning.
- Behavioral coverage includes route precedence/matching, real HTTP deep-refresh fallback, and rendered shell accessibility landmarks/skip links.
- Final `npm run lint`: passed.
- Final `npm test`: passed, 92/92 tests.
- Final `npm run build`: passed with the existing large-chunk warning.
- Final `npm run verify`: passed.
- Docker build: not required for this routing/UI-shell phase.

Feature gate:

- `FEATURE_CLIENT_ACCOUNTS=false` remains the exact gate until client-account staging and migration pass. Reserved account routes remain inactive; legacy token access is unchanged.

Known limitations:

- Client account authentication and dashboards are route reservations only and remain intentionally unavailable.
- Google account linking/Drive, GovInfo, OCR, CourtListener, Gmail sending, storage workers, and other deferred phases are not implemented here.
- The existing large frontend chunk warning remains; workflow code-splitting was outside this controlled routing phase.
- npm currently reports two high-severity React Router advisories affecting published 7.x ranges. Version 7.18.1 is browser-only here (no React Router framework actions, SSR, RSC, or server actions); upgrading remains required when a non-vulnerable compatible release is published.

## V1 Completion Phase — Central Configuration and Safe Provider Foundations

Status: Complete.

Implemented:

- Added one typed server configuration module with strict boolean/port/environment validation and conditional provider requirements.
- Added independent default-false flags for public landing, async ingestion, GovInfo, CourtListener, Google Drive, Gmail send, OCR, client accounts, and firm teams.
- Kept GovInfo, CourtListener, Gmail send, and OCR unavailable in this phase; attempted activation fails safely at startup.
- Removed every canned CourtListener and GovInfo result. Disabled adapters return no authority, and Assistant requests are independently gated on server flags.
- Added typed boundaries for object storage, jobs, malware scanning, GovInfo, Google Drive, transactional email, and observability without implementing deferred providers.
- Added an explicit allow-listed `/api/config` browser payload and conditional Assistant controls.
- Added `/api/health/live` and `/api/health/ready` foundations while retaining `/api/health`.

Schema changes:

- None. No migration or stored-data operation was required.

Dependencies added:

- None.

Verification:

- Pre-change `npm ci`: passed; 0 vulnerabilities.
- Pre-change `npm run verify`: passed with 82/82 tests and the existing Vite large-chunk warning.
- Phase tests cover default/independent flags, conditional configuration validation, deferred activation, empty adapters, forged source selections, public configuration allow-listing, credential-safe errors, conditional controls, and health routes.
- Final `npm run lint`: passed.
- Final `npm test`: passed, 89/89 tests.
- Final `npm run build`: passed with the existing Vite large-chunk warning.
- Final `npm run verify`: passed.
- Docker build: not required for this configuration-foundation phase; the Docker configuration regression test passed.

Feature gate:

- `FEATURE_GOVINFO=false` remains the exact live-connector staging gate.

Known limitations:

- GovInfo has no live implementation in this phase.
- CourtListener, Gmail sending, and OCR remain intentionally deferred.
- Health foundations currently check application/database readiness only; detailed provider checks belong to phases that activate those providers.

## Preparation baseline

- Date: 2026-07-21
- Dependency command: `npm install` (no `package-lock.json` existed initially).
- Installed declared dependency ranges only; `node_modules` remains ignored.
- Initial registry attempt encountered a transient `ECONNRESET`; bounded retry succeeded.
- Pre-change `npm run lint`: **passed** (`tsc --noEmit`).
- Pre-change `npm run build`: **passed** (Vite frontend and esbuild server bundle).

## Phase 0 — Preserve and Protect the Current Baseline

Status: Complete.

Planned/implemented foundation changes:

- Numbered, repeatable, transactional migrations.
- Safe opt-in demo data seeding with no startup deletion.
- Stable vector index creation without routine drop/rebuild.
- Failed embeddings remain unindexed rather than receiving random vectors.
- Conversation deletion preserves associated Work Product.
- Generated drafts no longer create parallel Source documents.

Schema changes:

- Add `schema_migrations` tracking table.
- Preserve the existing schema through migration 001.
- Change the draft/thread foreign key to `ON DELETE SET NULL` through migration 002.

Verification:

- `npm test`: passed, 2 tests.
- `npm run lint`: passed.
- `npm run build`: passed.

- Code-path verification confirms disabled seeding returns before demo writes and no startup cleanup delete remains.
- Live validation-database verification passed on 2026-07-21: migrations 001–004 applied once, protected pre-existing row counts reconciled without deletion, demo seeding remained disabled across restarts, and the vector index retained its identity.

## Phase 1 — Authentication and Ownership

Status: Complete (code, automated, and live validation-database verification).

Implemented:

- Migration 003 adds nullable legacy-safe password/timestamp columns, case-insensitive unique email index, and server-side sessions.
- Deterministic legacy migration requires all three approved environment variables, validates the exact User/Firm relationship and Matter/document consistency, assigns only null legacy ownership, and fails safely on missing/ambiguous ownership.
- Salted Node `scrypt` password hashes and constant-time verification.
- Secure random session tokens; only SHA-256 token hashes are stored.
- Seven-day server-side sessions with HTTP-only, `SameSite=Lax` cookies and production-only `Secure`.
- Signup, login, logout, and session-me endpoints.
- All other APIs require a server-validated session.
- Signup creates one empty firm, one user, and one authenticated session transactionally.
- Monochrome login/signup gate and sidebar account email/logout control.
- Removed all first/default/fallback user and firm database selection.

Verification:

- `npm test`: passed, 5 tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- Live legacy login/backfill passed with the exact configured owner; five null-Matter drafts were preserved in one imported `On Hold` Matter.
- Live signup/session/login/logout checks passed for two temporary accounts, including separate empty workspaces, case-insensitive duplicate rejection, uniform invalid-login errors, and server-side logout invalidation.

## Phase 2 — Search and Context Isolation

Status: Complete (code, automated, and live multi-account/multi-Matter verification).

Implemented:

- Migration 004 adds the minimal Matter status needed for imported Work Product, classifies only exact generated-draft duplicate documents, and adds ownership-path indexes.
- Null-Matter legacy drafts are preserved in a deterministic `Imported Legacy Work Product` Matter marked `On Hold`; migration refuses ambiguous ownership.
- Cases, documents, links, threads, messages, drafts, reads, writes, deletes, and exports now require authenticated ownership context in database methods.
- Firm Library lists/searches only workspace documents with `case_id IS NULL` and excludes confidently identified generated-draft duplicates.
- Matter retrieval includes only direct documents for that owned Matter and Firm Library documents linked to that Matter.
- Workspace and context predicates are inside vector SQL before distance ordering and limiting.
- Section suggestions and automatic Matter linking use only the authenticated Firm Library.
- Direct document deletion validates visible context; deleting a linked Firm Library source from a Matter removes only the link.
- General thread listing is General-only; History has a separate authenticated all-context query.
- History selection restores the stored General/Matter context; changing Assistant context clears the prior active thread.
- New generated Work Product requires an owned Matter and no longer produces a parallel Source document.
- Draft/message direct reads, updates, and exports require matching parent context.

Verification:

- `npm test`: passed, 9 tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- Static regression tests confirm legacy global query shapes are absent and General/Matter vector ownership predicates precede ranking/limit.
- Live two-user/two-Matter direct-ID substitution passed without foreign disclosure or mutation.
- Live deterministic upload/search checks passed for General, direct Matter, linked Firm Library, unlinked Firm Library, cross-Matter, and cross-workspace boundaries.
- Live conversation deletion preserved Work Product and cleared only its thread reference; actual generated Work Product stayed on the correct Matter and created no parallel Source document.
- Full sanitized evidence is recorded in `docs/FOUNDATION_VERIFICATION.md`.

Known retained behavior:

- Existing ambiguous generated-draft duplicate documents remain preserved and unclassified for later review.
- Existing redundant `case_documents` rows are preserved.
- The global Drafts navigation remains until Phase 6; in General context it now returns no Work Product because saving/listing requires a Matter.
- Navigation remains otherwise unchanged; Phase 3 was not implemented.

## Foundation live verification gate

Status: Passed on 2026-07-21.

- Pre-migration ownership inspection found no ambiguous legacy owner, duplicate email, missing Firm ownership, or cross-workspace relationship.
- `npm test`: passed, 9/9 tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- No foundation defect was found and no `fix(foundation):` commit was needed.
- Before Phase 3, remove `LEGACY_OWNER_INITIAL_PASSWORD` from the runtime environment and restart once to confirm the stored legacy password hash remains sufficient.

## Phase 3 — Navigation and Firm Library Separation

Status: Complete.

Implemented:

- Global navigation now exposes Assistant, Matters, Firm Library, temporary Drafts & Documents, History, and Settings while retaining the existing collapsible sidebar and account footer.
- The combined Workspace & Library view is no longer routed by the application.
- Matters has a separate global landing page and existing Matter records remain available.
- Firm Library is a workspace-only view with semantic/keyword search, section browsing, document preview, paste/upload indexing, and removal.
- Firm Library contains no Matter list, Matter scope selector, or Matter creation control.
- Minimal Settings displays authenticated name/email and logout.
- No schema, migration, API, ownership, or retrieval-foundation changes were required.

Verification:

- `npm test`: passed, 11/11 tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- Static/manual inspection confirmed distinct navigation routes and Firm Library requests remain fixed to `caseId=null`/General (`wide`) scope.
- Phase 4 has not been included in this commit; its stricter starting-input creation flow remains next.

## Phase 4 — Matter Core

Status: Complete.

Implemented:

- Migration 005 adds nullable Matter details, suggestion flags, updated/activity timestamps, Source metadata, link origin/date metadata, and ownership-path activity indexes.
- Existing Matter and Source records were backfilled non-destructively; preserved ambiguous documents and redundant links were not converted or deleted.
- Matters support card/list layouts, name/client search, and last-activity/created/name sorting.
- Matter creation requires a name, assignment description, and at least one note, pasted document, or selected Firm Library document before insertion.
- Automatic Firm Library matching searches only the authenticated Firm Library using Matter name plus assignment, links at most three results above a similarity threshold, and labels links `AI Suggested` without copying.
- Matter workspace contains exactly Overview, Matter Intelligence, Sources, Work Product, and Collaboration tabs; later-phase tabs remain inert placeholders.
- Overview supports the approved details, four manual statuses, and visibly suggested field confirmation/edit/removal.
- Sources provides one owned list with type/origin/date/state metadata, search, add, preview, and context-safe removal. Removing a Firm Library Source deletes only its link.
- Compatible `/api/cases` routes remain; new detail/update and Matter Source routes enforce authenticated workspace ownership.

Verification:

- Migration 005 applied exactly once to the configured PostgreSQL validation database.
- Live validation rejected a no-input Matter without inserting it, created an owned Matter with a starting note/link, updated Overview, denied a foreign account, and preserved the Firm Library document after unlink.
- Existing rows received activity timestamps; two ambiguous draft-like documents and at least the six retained redundant links remain preserved.
- `npm test`: passed, 14/14 tests.
- `npm run lint`: passed.
- `npm run build`: passed.

## Phase 5 — Assistant and History Context

Status: Complete.

Implemented:

- Assistant now exposes a persistent General Assistant or specific Matter selector and repeats the selected context in the active-conversation header/empty state.
- Visible Assistant context language uses General, Firm Library, Matter, and Matter Sources rather than Wide Library or Case workspace terminology.
- Changing the selector clears the incompatible active thread before changing context.
- Opening History retains the server-stored `case_id` as authoritative and restores General or the exact Matter before loading the conversation.
- History is grouped into General Assistant and one section per Matter; each group is ordered by latest message activity with thread creation as fallback.
- General and Matter retrieval queries were not changed, preserving the verified isolation foundation.

Verification:

- Live owned History loading returned both General and Matter conversations, all with consistent stored scope, ordered by recent activity.
- Focused tests cover persistent context labels, thread clearing, grouping, activity ordering, and owned History SQL.
- `npm test`: passed, 16/16 tests.
- `npm run lint`: passed.
- `npm run build`: passed.

## Phase 6 — Work Product Migration

Status: Complete.

Implemented:

- Migration 006 adds updated/share/origin/revision metadata and a nullable self-reference for copied Client Revisions; existing Work Product is backfilled without moving or deleting rows.
- The existing Markdown editor, save behavior, preview, and DOCX export now live in each Matter's Work Product tab.
- Users can create blank Work Product, generate it from a Matter conversation, duplicate it, share it with the client, and stop sharing.
- Client Revision creation inserts a separate child copy and never updates the lawyer original.
- Global Drafts & Documents navigation/routing is removed after confirming every draft has a Matter, including imported legacy Work Product.
- Existing compatibility draft endpoints remain temporarily for the reused editor and generated-draft flow; every direct operation still requires Matter/workspace ownership.

Verification:

- Migration 006 applied exactly once; all existing Work Product has `case_id` and `updated_at`.
- Live validation created, duplicated, shared, and client-revised owned Work Product, denied a foreign workspace, preserved the original content, and did not create a Source document.
- Previously verified conversation deletion survival remains present with a null thread reference and retained Matter.
- Imported legacy Work Product remains accessible in its imported Matter.
- `npm test`: passed, 18/18 tests.
- `npm run lint`: passed.
- `npm run build`: passed.

## Phase 7 — Matter Intelligence

Status: Complete.

Implemented:

- Migration 007 creates one compact Matter Intelligence record per Matter with Markdown content, Source snapshot, generated/edited dates, and an internal version number.
- Intelligence has no automatic generation path; the empty state exposes only `Generate Matter Intelligence`.
- Generation receives the owned Matter and its active Sources from Matter-scoped SQL, uses exactly the five approved sections, requests title-based Source citations, and excludes task-management controls.
- The page states that lawyer review is required and supports direct edit/save/regenerate.
- Source snapshot comparison displays the approved stale-Source warning without automatically regenerating.
- Matter Intelligence uses a dedicated existing Gemini lightweight-model task configuration after the drafting model returned a temporary high-demand response during live verification.

Verification:

- Migration 007 applied exactly once.
- Live explicit generation returned all five sections and a non-empty Source snapshot; editing persisted, a new Source triggered the stale warning, and regeneration incremented the internal version and cleared the warning.
- A foreign workspace received a safe not-found response for the Matter Intelligence route.
- No record existed before the explicit generation action.
- `npm test`: passed, 20/20 tests.
- `npm run lint`: passed.
- `npm run build`: passed.

## Phase 8 — Collaboration

Status: Complete.

Implemented:

- Migration 008 creates `matter_client_access`, collaboration requests, request-to-Work-Product links, client responses, and ownership-path indexes.
- A pre-existing unrelated `client_access` table with one legacy row and a plaintext `token` column caused the first migration attempt to roll back. It was inspected read-only and preserved unchanged; the compact feature uses the namespaced hash-only table instead.
- One client collaborator can be saved per Matter, prefilled from Matter details, activated with a cryptographically random invite link, rotated by generating a new link, and revoked immediately.
- Only the token hash is stored; the raw token is returned once in a no-store response for copying and is never logged.
- Collaboration summarizes shared Work Product without copying documents.
- Lawyers can send the six approved request types with one or more validated Matter Work Product documents and an instruction.
- Responses are displayed with a compact unread count on the Collaboration tab and can be marked read; no global notification center was added.

Verification:

- Migration 008 applied exactly once after the safe table namespace correction.
- Live validation confirmed one-client storage, hash-only activation, shared-document summary, request links, incoming response/unread/read behavior, foreign-workspace denial, and immediate token removal on revoke.
- The unrelated legacy `client_access` row had an identical fingerprint before and after Phase 8 verification.
- `npm test`: passed, 23/23 tests.
- `npm run lint`: passed.
- `npm run build`: passed.

## Phase 9 — Client Portal

Status: Complete.

Implemented:

- Migration 009 adds portal comments. Temporary Client Assistant text remains request-only and is not persisted.
- `/client/:token` renders a public Client Portal independently of lawyer sessions; API routes hash the token and resolve one active, unrevoked Matter before any data query.
- The portal contains exactly Shared Documents, Requests, and Assistant tabs with no Client Activity.
- Shared Work Product can be viewed, downloaded, commented on, and edited only as a separate Client Revision linked to the preserved lawyer original.
- Requests support acknowledgement, comment, written answer, uploaded/existing portal documents, and Client Revisions.
- Client uploads are embedded and stored as direct Matter Sources labelled `Client Submission` with client origin.
- Client Assistant accepts only explicitly selected shared/request Work Product, Client Revisions, direct Client Submissions, or request-scoped temporary text. Its prompt and SQL exclude Firm Library, Matter Intelligence, lawyer conversations, external legal research, web search, and connectors.
- Portal content is never automatically sent to the lawyer; only explicit comments and request responses enter Collaboration.

Verification:

- Migration 009 applied exactly once.
- Live token verification passed shared view/download/comment, copy-not-overwrite, client upload classification, request response, and selected-document Client Assistant grounding.
- Direct IDs for unshared Work Product, another Matter's Work Product, and Firm Library content were denied.
- Revocation immediately blocked portal summary, Work Product, and Assistant routes using the prior link.
- `npm test`: passed, 27/27 tests.
- `npm run lint`: passed.
- `npm run build`: passed.

## Phase 10 — Cleanup and Hardening

Status: Complete.

Implemented:

- Removed the unused 665-line combined `WorkspaceView`, the obsolete global `GET /api/drafts` list route, and the unused `WorkspaceState` type. Matter-scoped Work Product read/edit/export/generation routes remain for the active editor and compatibility.
- Removed fake Google Drive/local attachment controls and a document picker that displayed selections without sending their content to the Assistant.
- Removed fabricated Format Painter, change-tracking, and hardcoded version controls from the Work Product editor while preserving real Markdown editing, undo/redo, save, preview, duplicate, sharing, and DOCX export.
- Replaced residual user-facing Workspace Library/Draft error language with Firm Library, Matter Sources, and Work Product terminology.
- Marked both local hardcoded CourtListener and GovInfo adapters as `Simulated` wherever users can enable or see them.
- Added `scripts/phase10-live-smoke.ts`, which generates random credentials at runtime, emits no credentials/tokens, retains its validation accounts/data, and checks the complete foundation/product isolation surface.
- Added focused cleanup and ownership regression assertions, bringing the suite to 30 tests.

Live verification:

- PostgreSQL 17 validation database; migrations 001–009 are present exactly once. Phase 10 required no schema migration.
- Start-of-Phase-10 counts were users 5, Matters 10, documents 28, chunks 218, links 10, threads 48, messages 159, Work Product 16, sessions 18, Intelligence 1, compact client access 1, requests 1, responses 2, and portal comments 1.
- Final counts after retaining all smoke attempts/fixtures were firms 15, users 15, Matters 30, documents 53, chunks 243, links 15, threads 52, messages 159, Work Product 26, sessions 26, Intelligence 2, compact client access 4, requests 1, responses 2, and portal comments 1.
- No pre-existing document, chunk, Case-document link, conversation, message, or Work Product was deleted. The smoke intentionally deletes only the new conversation created to test deletion semantics; its Work Product survives with a null thread reference.
- Zero document-to-Matter Firm mismatches, cross-Firm Case-document links, cross-workspace threads, or Work Product rows without a Matter were found after the smoke.
- Signup isolation, separate workspaces, case-insensitive duplicate rejection, initial empty state, uniform invalid login, logout/session invalidation, two-user direct-ID denial, and two-Matter search isolation passed.
- Firm Library classification, General-only Firm Library retrieval, Matter direct/linked retrieval, unlinked and foreign Source denial, and SQL-before-vector-ranking checks passed.
- General/Matter thread listings remained separate; cross-context IDs, document mutation, message mutation, Work Product read/update/export, and foreign search were denied without changing foreign data.
- Conversation deletion preserved Work Product; Work Product creation created no Source document; Client Revision copied rather than overwrote the lawyer original.
- Only explicitly shared portal content was visible. Supplying a private Work Product ID to Client Assistant safely rejected the whole request; an allowed selection succeeded and returned only that source.
- Explicit Matter Intelligence generation stayed in its Matter and was unavailable to the other workspace. Invitation revocation immediately invalidated the portal.

Retained records and limitations:

- The two approved ambiguous draft-like legacy documents and six approved redundant legacy Case-document links remain untouched. Additional links and generated-draft duplicate flags created by approved validation/product work are also retained.
- Temporary validation accounts and all non-ephemeral validation fixtures remain in the validation database as required.
- The unrelated pre-existing `client_access` table and its single legacy plaintext-token row remain unchanged and are not used by the compact portal. It requires an explicit owner decision before any future migration or removal.
- CourtListener and GovInfo remain deterministic simulated adapters. Google Search grounding is the only live optional external research control.
- Document entry uses extracted/pasted text; native binary parsing and email delivery of invite links are not implemented. Invite links are generated for copying.
- Browser-level responsive/collapsed-sidebar and real DOCX-opening checks remain recommended human QA; production build and API/database smoke passed.

Final gates:

- `npm test`: passed, 30/30 tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npx tsx scripts/phase10-live-smoke.ts`: passed all reported live checks.

## Phase 11 - Shared UX, Markdown, File Ingestion, and Assistant Continuity

Status: Complete.

Implemented:

- Added a shared citation-aware Markdown renderer for Assistant responses, response editor preview, and Matter Intelligence read-only content, including GFM tables, lists, headings, links, block quotes, and compact legal-document spacing.
- Added memory-based server extraction for PDF, DOCX, and TXT files with extension/MIME checks, file count, file size, total extracted-character limits, and useful rejection errors for unsupported, corrupt, encrypted, or textless files. OCR is not implemented.
- Added temporary Assistant file attachments that extract text server-side, show removable chips/states, are sent only with the current request, appear as temporary citation labels, and are cleared only after successful send.
- Restored bounded Assistant conversation history in model requests. Prior user/assistant turns are included as conversational context only; retrieval remains scoped to the stored General or Matter context.
- Replaced keyword hardcoded follow-up arrays with model-generated suggestions persisted in message metadata. Suggestion generation failure falls back to no suggestions without failing the answer.
- Made Improve use a distinct `Improving...` state and server-side Markdown-marker sanitization before text enters the editable prompt box.
- Removed visible `(Simulated)` text from CourtListener/GovInfo names, removed Assistant response Export, removed App-level message/history sidebar auto-collapse, and added clearer async labels to the Assistant send/improve flow.
- Added Matter Intelligence formatted rendering and an owned DOCX export route that converts basic Markdown structure instead of dumping Markdown syntax.

Schema changes:

- Migration 010 adds `messages.metadata JSONB NOT NULL DEFAULT '{}'::jsonb`.
- Migration 010 adds `messages_thread_created_idx` for bounded recent history reads.

Dependencies added:

- `multer`, `@types/multer`, `pdf-parse`, `mammoth`, and `remark-gfm`.

API changes:

- Added `POST /api/extract-files` for authenticated temporary extraction.
- `POST /api/documents` and `POST /api/cases/:id/sources` now also accept memory-backed multipart file uploads.
- `POST /api/threads/:id/messages` accepts request-scoped `temporaryFiles`.
- Added `GET /api/cases/:caseId/intelligence/export`.

Verification:

- `npm test`: passed, 36/36 tests.
- `npm run lint`: passed.
- `npm run build`: passed.

Known limitations:

- PDF support is extractable text only; scanned/image PDFs require OCR, which remains intentionally unsupported.
- CourtListener and GovInfo remain local deterministic adapters; the visible UI no longer labels them as simulated, and no live connector claim was added.

## Phase 12 - Lawyer Matter and Work Product Corrections

Status: Complete.

Implemented:

- Simplified Create Matter so only Matter name and assignment description are required. Optional starting files and Firm Library selections are processed after the Matter is created, with partial-failure warnings instead of deleting the created Matter.
- Added non-blocking AI Overview suggestions for client name, practice area, jurisdiction, and preliminary objectives using only Matter name, assignment description, and optional starting content. Suggested values use existing suggestion flags.
- Redesigned Matter Overview as display-first with Edit Overview, Save, Cancel, `Saving...`, saved/error feedback, and suggested-value indicators.
- Converted Matter Intelligence and Work Product read-only surfaces to formatted Markdown rendering. Matter Intelligence and Work Product DOCX exports use Markdown-to-DOCX conversion for headings, lists, paragraphs, bold/italic text, and citation text.
- Replaced pasted-text Firm Library upload with local PDF/DOCX/TXT upload and a title defaulting to the filename.
- Replaced pasted-text Matter Source upload with a local PDF/DOCX/TXT picker while preserving Note and Firm Library source paths.
- Added formatted Work Product editing with `@uiw/react-md-editor` while keeping Markdown as the canonical stored content.
- Added `Sharing...` and `Stopping...` states for Work Product sharing controls, with duplicate-click prevention.
- Grounded generated draft prompts with Matter name, assignment description, client details when present, practice area, jurisdiction, preliminary objectives, authenticated lawyer name, firm name, and a server-controlled current date.
- Added async labels/disabled feedback to the main Phase 12 flows touched by this phase.

Schema changes:

- None. Phase 12 uses existing Matter detail fields, suggestion flags, Sources, Work Product, and Phase 11 message metadata.

Dependencies added:

- `@uiw/react-md-editor` and its bundled Markdown preview styling dependency tree.

API changes:

- `POST /api/cases` now accepts multipart files, no longer requires a starting note/document/source, and may return `warnings` for optional source failures.
- Generated draft creation now includes server-derived Matter/account/date metadata in the model prompt.

Verification:

- `npm test`: passed, 40/40 tests.
- `npm run lint`: passed.
- `npm run build`: passed. Vite emitted a large-chunk warning after adding the focused Markdown editor dependency.

Known limitations:

- OCR remains unsupported for scanned PDFs.
- Work Product editing is Markdown-backed with a formatted editor/preview rather than a full legal word processor.
- Client Portal upload/editing still has earlier compact behavior and was not broadened beyond the requested lawyer-side corrections.

## Phase 13 - Collaboration and Client Portal Correction

Status: Complete.

Implemented:

- Reworked lawyer Collaboration so the no-collaborator state shows only a centered invite form with client name/email and progress labels, then transitions into the normal view after success.
- Replaced the old editable collaborator box with a compact identity/status header. Copy Invite Link now rotates/generates a fresh token, copies the new URL, confirms older links are invalid, and continues storing only token hashes.
- Reordered Collaboration to Send Request, Shared Documents, then Requests and Responses. Request instructions are now optional, document selection remains required, sending has duplicate-click prevention, and errors preserve selections.
- Changed Shared Documents into a compact disclosure and expanded request/response history so attached Work Product titles and response attachments are visible.
- Updated Client Portal shared-document viewing and client revisions to use the shared formatted Markdown renderer and the existing formatted Markdown editor while preserving the original lawyer Work Product.
- Replaced global request response state with per-request state, exposed only Acknowledgement, Comment, Upload files, and Shared files, and added per-request sending/error handling.
- Added token-scoped portal file uploads for PDF/DOCX/TXT using the Phase 11 extraction utility and linked multiple uploaded/shared attachments to a single response without replacing legacy response columns.
- Sorted unanswered requests before answered requests, ordered answered requests by recent response activity, and updated only the responded request's status/timestamp.
- Replaced the one-shot Client Assistant with a persistent collaborator-scoped chat, explicit source dropdown/chips, bounded follow-up history, formatted Markdown responses, and a document-understanding disclaimer.
- Kept portal source selection limited to shared/requested Work Product, Client Revisions, and token-scoped portal files; no Firm Library, Matter Intelligence, lawyer Assistant threads, unshared Work Product, other Matters, external search, CourtListener, or GovInfo are exposed.

Schema changes:

- Migration 011 adds `client_response_attachments` for additive multi-attachment responses while preserving existing `client_responses` columns.
- Migration 011 adds `portal_chat_messages` for one persistent isolated portal chat per active collaborator.

Dependencies added:

- None. Phase 13 reuses the Phase 11 file extraction and Phase 12 formatted Markdown editor dependencies.

API changes:

- `POST /api/cases/:caseId/collaboration/requests` now accepts an optional instruction while still requiring selected Work Product.
- `POST /api/cases/:caseId/collaboration/invite` continues to return a one-time plaintext link but now supports safe invite rotation for Copy Invite Link.
- `POST /api/portal/:token/documents` now accepts memory-backed multipart PDF/DOCX/TXT uploads and stores extracted text as token/Matter-scoped Client Submission documents.
- `POST /api/portal/:token/requests/:requestId/responses` now accepts multipart responses, the four approved response types, multiple uploaded files, and multiple shared Work Product attachments.
- `POST /api/portal/:token/assistant` now persists portal chat turns, includes bounded prior portal history, and rejects unavailable selected sources on every request.

Verification:

- `npm test`: passed, 50/50 tests.
- `npm run lint`: passed.
- `npm run build`: passed. Vite still reports the existing large chunk warning.

Known limitations:

- OCR remains unsupported for scanned PDFs.
- Portal chat is intentionally one simple persistent chat per active collaborator.
- Client revisions remain Markdown-backed through the focused formatted editor rather than a full word processor.

## Focused Fix Phase - Matters Upload and Document Generation UX

Status: Complete.

Implemented:

- Added a shared cumulative file-selection hook and removable selected-file rows using browser file identity (`name`, `size`, `lastModified`), append/dedupe behavior, native input reset, and a five-file inline limit message.
- Applied cumulative multi-file selection to Matter creation, direct Matter Source uploads, Firm Library uploads, Client Portal request attachments, and Assistant temporary attachments.
- Updated Assistant temporary file extraction so overlapping batches update only the pending entries from the completed batch.
- Updated Matter Sources to link multiple Firm Library documents in one submission through checkbox selection while preserving the note path and singular server compatibility.
- Changed `POST /api/cases/:id/sources` and `POST /api/documents` to use `MAX_FILE_COUNT`, extract full batches, persist every extracted file, and keep custom titles to one-file submissions.
- Added a reusable Markdown-backed rich document editor and used it for Matter Intelligence edit mode, Matter Work Product edit mode, and Client Portal Edit a Copy.
- Added targeted Matter Intelligence source-label cleaning for exact `[Source: ...]` labels on generation, read, save, and DOCX export without bulk database mutation.
- Removed the Matter Intelligence generic review banner/empty-state warning and removed generated legal-email disclaimer instructions and related generic disclaimer prompts.

Schema changes:

- None. No migration was added and no data reset, table rename, or destructive database change was performed.

Dependencies added:

- None. The rich editor uses existing React/browser editing APIs and keeps Markdown as the persisted/API representation.

API changes:

- One-file upload responses remain document-shaped and now include a `documents` array for updated clients.
- Multi-file upload responses return `{ documents: [...] }`.
- Matter Source Firm Library linking now accepts `libraryDocumentIds` while retaining singular `libraryDocumentId`.

Verification:

- `npm ci`: passed.
- `npm run lint`: passed before tests.
- `npm test`: passed, 57/57 tests.
- Final `npm run lint` and `npm run build` will be run after this documentation update.

Known limitations:

- OCR remains unsupported for scanned PDFs.
- The rich editor is intentionally focused on paragraphs, headings, emphasis, underline, lists, links, undo/redo, and sanitized Markdown round trips rather than being a full word processor.
- Manual browser verification remains to be performed in a live session with representative files and generated content.

## Focused Assistant UX and Response Cleanup Phase

Status: Complete.

Implemented:

- Removed the full-width separator between Assistant conversation messages by dropping the message-wrapper bottom border while preserving vertical spacing.
- Stored ready temporary attachment filenames on the originating user message in `messages.metadata.attachments` and rendered quiet, non-clickable filename chips on optimistic and persisted user messages.
- Added shared Assistant citation utilities for canonical persistence, defensive rendering, copy-friendly display text, and Google grounding numeric rewrite without fallback `cit_n` invention.
- Updated Assistant response persistence and copy behavior so valid internal citations display as numbered citations and unresolved internal citation tokens are removed.
- Added a narrow generated-boilerplate cleaner for standalone generic legal-advice, consultation, AI, lawyer-review, informational-purpose, and limitation boilerplate at the beginning or end of generated content.
- Applied generated-output cleanup to Assistant responses, Client Assistant responses, Matter Intelligence generation, and generated Work Product.
- Added Assistant and Client Assistant prompt instructions against generic disclaimer boilerplate while preserving missing-source and uncertainty behavior.

Schema changes:

- None. This phase reuses the existing `messages.metadata` JSONB column.

Dependencies added:

- None.

API changes:

- `POST /api/threads/:id/messages` now saves only submitted ready temporary attachment filenames in user-message metadata. File contents and extracted text remain request-scoped retrieval context only.

Verification:

- `npm ci`: passed.
- `npm run lint`: passed before tests and will be rerun after this documentation update.
- `npm test`: passed, 63/63 tests.
- `npm run build` will be run after the final lint pass.

Known limitations:

- Manual browser verification was not performed in this non-interactive run.
- Historical messages with no attachment metadata render as before; no backfill was performed.

## Focused Work Product Presentation and Editing Phase

Status: Complete.

Implemented:

- Made the Matter Work Product preview and editor scroll surfaces fully white, including empty space below short documents and the scrollable area behind long documents.
- Added a shared `WorkProductDocument` preview surface and reused it in the Matter Work Product editor and Client Portal shared-document preview.
- Repaired the existing Markdown-backed rich editor rather than replacing it: stored Markdown is converted before paint, editor content remains white, and underline markup no longer appears as escaped raw source.
- Updated the Work Product header so the complete title wraps on its own row and all existing actions remain in a separate toolbar row.
- Added `stripInternalCitationsForWorkProduct` and applied it through Work Product generation, reads, saves, duplication, sharing responses, Client Revisions, portal views, and DOCX export without a bulk database rewrite. Bare bracketed numeric markers are stripped only on freshly generated output to avoid deleting user-authored footnotes.
- Updated Work Product generation instructions so generated memos, summaries, and emails are standalone deliverables without internal Assistant citation tokens, numbered source markers, automatic references, sources, citations, endnotes, or bibliographies unless explicitly requested.
- Reused the existing generated-boilerplate cleaner from the Assistant cleanup phase; no duplicate disclaimer cleanup system was added.

Schema changes:

- None. No migration, data reset, table rename, or destructive database change was performed.

Dependencies added:

- None.

Verification:

- `npm ci`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 71/71 tests.
- `npm run build`: passed. Vite emitted the existing large-chunk warning.

Known limitations:

- Manual browser verification was not performed in this non-interactive run.
- Historical explicit internal Assistant tokens such as `[cit_1]` are hidden without a destructive rewrite. Historical bare numeric markers such as `[1]` are not globally stripped from saved documents because they are indistinguishable from user-authored footnotes without extra metadata.

## Focused Client Portal Reliability and Presentation Phase

Status: Complete.

Implemented:

- Verified Client Portal Edit a Copy already used the shared `RichDocumentEditor` and retained that path with regression coverage.
- Added migration 012 to correct `client_response_attachments`: each attachment now has a stable row `id`, nullable `document_id`/`draft_id` alternatives, a target check constraint, and partial unique indexes for response-document and response-draft relationships.
- Reworked portal request responses so uploaded files and selected shared Work Product are validated before persistent writes, malformed `draftIds` returns a clear 400, and unexpected failures are logged without raw portal tokens or extracted content.
- Moved response, uploaded Client Submission document, generated Client Response Work Product, attachment rows, and request status updates into one database transaction.
- For each uploaded response file, created private Matter Work Product titled `Client Response — original-filename.ext` with `origin = "Client Response Upload"` and `revision_type = "Client Response"` while preserving the Client Submission document representation.
- Attached uploaded response rows to both the Client Submission document and the matching Client Response Work Product; shared-file responses attach existing permitted Work Product without copying or renaming it.
- Updated lawyer Collaboration responses from nested button cards to semantic response cards with separate unread and attachment-opening controls. Draft attachments open through the existing Matter Work Product tab/editor.
- Added attachment chips to the client-side latest-response confirmation while preserving failed file selections and per-request state.
- Removed visible source attribution from Client Assistant generation by replacing the old `[Source: exact title]` prompt instruction and adding a narrow `cleanClientAssistantContent` cleaner for generated source tags and trailing Sources/References sections.
- Reused the existing generic generated-boilerplate cleaner for Client Assistant disclaimer cleanup.

Schema changes:

- Migration 012 is additive and corrective. It preserves the `client_response_attachments` table and existing rows, drops only the invalid primary-key constraint, and keeps the existing response/document/draft foreign-key behavior.

Dependencies added:

- None.

Verification:

- `npm ci`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 79/79 tests.
- `npm run build`: passed. Vite emitted the existing large-chunk warning.

Known limitations:

- Original uploaded file bytes are still not retained by the application; uploaded responses are viewable through extracted Client Submission text and the corresponding Client Response Work Product.
- Manual browser verification remains to be performed in a live session.

## Final Deployment Readiness and Exepts Branding Pass

Status: Complete.

Implemented:

- Replaced active Legal AI product branding with text-only Exepts branding in authentication, the expanded sidebar, the collapsed sidebar `E` lettermark, browser metadata, package metadata, and the Assistant model-service fallback error.
- Removed only the scales icons used in product brand areas while retaining all navigation, toolbar, status, file, and action icons.
- Renamed the npm package to `exepts`, made npm and `package-lock.json` canonical, removed the stale `bun.lock`, pinned Node 22 with `.nvmrc` and `engines.node`, and documented npm 10 through `packageManager`.
- Added a cross-platform production launcher so `npm start` always sets `NODE_ENV=production` before loading the built server; `npm run dev` remains unchanged.
- Added a deterministic multi-stage Node 22 slim Docker build, a non-root runtime, Compose configuration with `.env`, port mapping, restart behavior, and a Node-based `/api/health` health check.
- Added a GitHub Actions workflow for clean install, lint, tests, production build, and Docker image validation without secrets, database access, application startup, or deployment.
- Replaced AI Studio boilerplate in `.env.example` and `README.md` with the actual environment, deployment, migration, health-check, reverse-proxy, HTTPS, backup, update, and troubleshooting requirements.
- Removed unused `APP_URL` documentation after confirming the application has no `APP_URL` reference.
- Added focused regression tests for text-only branding, production runtime metadata, preserved internal persistence identifiers, and Docker deployment requirements.

Schema changes:

- None. No migration was created or changed, and no database schema or stored data operation was performed.

Dependencies added or changed:

- None. Dependency declarations and resolved dependency versions were not changed.

API changes:

- None. API request/response contracts, authentication, isolation, retrieval, prompts, model selection, and product functionality were intentionally unchanged.

Verification:

- `npm ci`: passed; 417 packages installed, 0 vulnerabilities reported.
- `npm run lint`: passed.
- `npm test`: passed, 82/82 tests.
- `npm run build`: passed. Vite emitted the existing large-chunk warning.
- `npm run verify`: passed, including lint, 82/82 tests, and the production build.
- `docker build -t exepts:local .`: passed on the final cached retry after transient npm registry idle timeouts; the image uses Node 22, runs as UID 1000, contains the production bundle and required externalized packages, and excludes `.env` and tests.
- `docker compose config --quiet`: passed.

Known limitations:

- A live container `/api/health` request was not run because no disposable database was used for this deployment pass; application startup automatically connects to the database and runs pending migrations.
- The existing Vite large-chunk warning remains. Bundle optimization was explicitly outside this pass.
