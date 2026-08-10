# Compact Upgrade Progress

## Google Drive folder navigation

- Enabled folder visibility for Google Drive Picker navigation while keeping folders unselectable.
- Preserved the existing `drive.file` scope and supported-file filtering; no schema, backend, dependency, or supported-file changes were made.
- Verification: focused cloud-file selection tests passed (14/14), lint passed, the full test suite passed (236/236), and the production build passed.

## Temporary attachment Assistant reliability

- Temporary attachment filenames are now bounded and explicitly identified to the planner as already extracted, authorized, and available; extracted contents remain request-scoped authorized evidence and are not persisted.
- A narrow deterministic guard prevents false attachment-access or attachment-location clarifications while preserving genuine planner and tool clarifications.
- Existing Matter Source, Firm Library, and Work Product authorization paths were preserved; no schema, dependency, OAuth, upload-limit, model, or UI changes were made.
- Verification: focused tests passed (30/30), lint passed, the full test suite passed (240/240), and the production build passed.

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

## Entry, Authentication & Onboarding Phase

Status: Complete.

Implemented:

- Standardized the public entry flow so a lawyer can request demo access without authentication while approved lawyer login remains restricted to email OTP for existing approved accounts.
- Added a public request-demo route, confirmation screen, and server-side access request submission that preserves the existing access-review workflow and pending approval state.
- Tightened lawyer OTP issuance so unknown, incomplete, pending, or denied lawyer accounts no longer receive login codes, while client and existing approved lawyer auth remain unchanged.
- Updated the public landing/auth UI copy to reflect the new request-demo and lawyer-only login experience.

Verification:

- `npm run lint`: passed (`tsc --noEmit`).
- `npm run build`: passed.
- Targeted entry-flow regression tests: passed (entry/auth/onboarding and access-gate coverage).

- Added URL-aware SPA navigation for the public landing page, authentication, onboarding, Assistant, Matters, individual Matter workspaces, Firm Library, History, Settings, and the existing token-authenticated Client Portal.
- Added browser History API navigation, safe protected-route return handling, back/forward support, URL-backed sidebar navigation, direct Matter URLs, and signed-in/signed-out route guards.
- Added a responsive grayscale Exepts landing page with supported product capabilities and authentication calls to action.
- Removed password fields and login/signup modes. The legacy password endpoints now return `410 Gone`; the existing `password_hash` column remains untouched for compatibility.
- Added Google OpenID authentication with the official `google-auth-library`, environment-only configuration, cryptographic state cookies, authorization-code exchange, ID-token verification, stable `sub` linking, conflict prevention, safe redirects, and normal Exepts sessions.
- Added Brevo email OTP authentication using built-in `fetch`, six-digit cryptographic codes, salted hashes, ten-minute expiry, five-attempt consumption, single-use enforcement, resend cooldown, hourly per-email request limits, generic request responses, and verified-email timestamps.
- Added required onboarding for new accounts with editable Google name prefilling, approved professional roles, independent or invitation-code workspace setup, optional practice areas, and transactional completion.
- Added idempotent Personal Workspace creation and case-normalized unique Firm invitation-code joining without adding invitation-code management UI.
- Updated session loading so authenticated pre-onboarding users can access `/api/auth/me`; all product APIs now additionally require completed onboarding and a valid matching workspace. Client Portal token routes remain separate and precede lawyer-session middleware.
- Removed the fake sidebar Firm fallback and use the authenticated workspace name.
- Updated shared account types for nullable pre-onboarding Firm/name state and the new verified-email, role, workspace, practice-area, and onboarding fields.
- Updated legacy/demo startup handling so normal passwordless accounts are not mistaken for pending legacy password migrations.
- Added focused tests for cookies, OTP hashing, email normalization, safe redirects, OAuth state, routing, account linking guards, migration compatibility, onboarding idempotency/code joining, and incomplete-account product protection.

Schema changes:

- Migration 020, `passwordless_authentication_and_onboarding`, is additive and non-destructive.
- `users.name` is now nullable until onboarding; `users.firm_id` remains nullable.
- Added `users.google_sub`, `email_verified_at`, `onboarding_completed`, `professional_role`, `custom_professional_role`, `workspace_type`, `practice_areas`, and `custom_practice_area`.
- Added a partial unique index for non-null Google `sub` identifiers.
- Added nullable `firm.invitation_code` with a case-normalized partial unique index. No default invitation code is created.
- Added `email_otp_challenges` with email, salted OTP hash, salt, expiry, attempt count, creation time, consumption time, and indexes for email/request enforcement and expiry cleanup.
- Existing users with a Firm are marked onboarding-complete and retain their current Firm and data.
- No table or column was deleted or renamed, and `password_hash` remains in place.

Dependencies added:

- `google-auth-library` for official Google OAuth and ID-token verification.

Verification:

- `npm ci`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 91/91 tests.
- `npm run build`: passed.

Known limitations:

- Google and Brevo delivery require the documented production credentials and authorized redirect URI; live third-party authentication was not exercised by the automated suite.
- Firm invitation codes can be consumed during onboarding, but creation and management remain intentionally outside this phase.
- Manual browser verification against a live migrated PostgreSQL workspace remains to be performed.

## Assistant Presentation UX Update

Status: Complete.

Implemented:

- Removed CourtListener and GovInfo controls, request flags, imports, queries, result aggregation, and connector citations from the Assistant flow; Web Search remains optional and user-controlled.
- Replaced the static analysis box with compact rotating high-level statuses tailored to Matter or Firm Library context, Web Search, and Deep Research.
- Added a short frontend response reveal that replaces the optimistic user message with the saved server message, streams one assistant placeholder, and finishes with the exact saved assistant message.
- Preserved temporary attachments, internal retrieval, citations, research steps, suggestions, feedback, Markdown, drafting, and editing behavior.

Schema changes:

- None.

Dependencies added or changed:

- None.

Verification:

- `npm run lint`: passed.
- `npm test`: passed, 93/93 tests.
- `npm run build`: passed with the existing Vite large-chunk warning.

### Working-state pacing follow-up

- Replaced the capped working-stage interval with one paced, continuously rotating request-aware timeout that includes Matter, Firm Library, attachment, Web Search, and Deep Research activities only when relevant.
- Slowed the presentation-safe response reveal with adaptive word-based chunking, a 3–8.5 second duration cap, exact final-message replacement, and reduced-motion support.
- Kept the Assistant API, retrieval, citations, stored messages, and error behavior unchanged.
- Focused Assistant tests, `npm run lint`, all 93 tests, and `npm run build` passed; the existing Vite large-chunk warning remains.

## Work Product Format, Naming & Source Preview Repair

Status: Complete.

Implemented:

- Restricted AI Work Product generation to `memo`, `email`, or `summary` and injects only the selected format's instructions.
- Named newly generated Work Product from the cleaned document's opening `Subject:` field, with the existing technical title retained only as a fallback.
- Preserved stored Work Product titles verbatim in the sidebar.
- Reused the read-only Work Product document renderer in the Matter Source preview modal.
- Added focused coverage for format isolation, Subject extraction and fallback, title preservation, and Source preview behavior.

Schema changes:

- None.

Dependencies added or changed:

- None.

Verification:

- Focused tests: passed, 7/7.
- `npm run lint`: passed.
- `npm test`: passed, 100/100 tests.
- `npm run build`: passed with the existing Vite environment and large-chunk warnings.

## Summary Titles & Firm Library Presentation

Status: Complete.

Implemented:

- Added a summary-only fallback that names newly generated Summary Work Product from the first meaningful opening Markdown heading when no generated Subject exists.
- Updated the Firm Library document modal to use the existing read-only Work Product renderer and match the Matter Source preview presentation.
- Removed the optional one-file title input and its upload FormData wiring from the Firm Library upload card.

Schema changes:

- None.

Dependencies added or changed:

- None.

Verification:

- Focused tests: passed, 11/11.
- `npm run lint`: passed.
- `npm test`: passed, 104/104 tests.
- `npm run build`: passed with the existing Vite environment and large-chunk warnings.

## Intelligent One-Time Conversation Titles

Status: Complete.

Implemented:

- Added best-effort AI titles for the first user message in newly started General and Matter Assistant conversations, using the existing fast Gemini model path and the complete request.
- Sanitized generated titles and conditionally stored them in the existing thread title field only while the saved message remains the thread's sole user message.
- Preserved the existing first-message title as the fallback for invalid output, timeouts, model failures, or ownership-safe update failures.
- Kept History as a reader of stored titles with its existing General Assistant and Matter grouping, open, delete, date, count, and layout behavior.

Schema changes:

- None.

Dependencies added or changed:

- None.

Verification:

- Focused conversation-title tests: passed, 5/5.
- `npm run lint`: passed.
- `npm test`: passed, 109/109 tests.
- `npm run build`: passed with the existing Vite environment and large-chunk warnings.

## Firm Settings Foundation

Status: Complete.

Implemented:

- Added stored Firm roles with two values only: Admin and Member.
- Independent onboarding now assigns Admin; invitation-code onboarding assigns Member without exposing a role selector.
- Added server-authorized Firm Settings for Admins to view and edit the existing Firm name, view or securely generate/regenerate its existing invitation code, and view a read-only same-Firm member directory.
- Added member-facing Account and read-only Firm details while keeping invitation codes and the Firm directory unavailable to Members.
- Firm name changes update the authenticated React Account immediately so the Sidebar reflects the saved name without refresh or logout.
- Preserved Firm Library access as shared for every user with the same `firm_id`, with other Firms excluded by the existing workspace-scoped queries.
- Matter ownership and Matter assignment were intentionally deferred. No Matter schema, authorization, visibility, route, query, conversation, Source, Intelligence, Collaboration, or UI behavior was changed.

Schema changes:

- Migration 021, `firm_admin_and_member_roles`, additively creates nullable `users.firm_role`, backfills existing `independent` users as `admin` and existing `firm` join users as `member`, adds a two-value check constraint, and adds a Firm/role index.
- Existing users, Firms, invitation codes, onboarding state, IDs, and application data are preserved.

Dependencies added or changed:

- None. Invitation codes use Node's existing cryptographic utilities and copying uses the browser Clipboard API.

Verification:

- Focused Firm Settings tests: passed, 11/11.
- `npm run lint`: passed.
- `npm test`: passed, 120/120 tests.
- `npm run build`: passed with the existing Vite environment and large-chunk warnings.

Known limitations:

- Role promotion, demotion, transfer, and user removal are intentionally outside this phase.
- Matter ownership and assignment remain intentionally deferred.

## Authenticated Client Workspace

Status: Complete.

Implemented:

- Added immutable lawyer/client account separation through the existing OTP and Google authentication flows; client accounts bypass Firm onboarding and route directly to a narrow Client Workspace.
- Added server-side lawyer and client guards, with client-owned Assistant conversations isolated from lawyer History, Matter conversations, and Firm queries.
- Turned existing lawyer-generated collaboration links into authenticated, email-matched claims without changing token format, copying Matter data, or replacing collaboration records.
- Added persistent, revocation-aware Shared Matters with card/list views, secure link entry, shared-document preview/download, and the existing request, response, and upload workflow.
- Added a general client-only Assistant with persistent one-time-titled conversations, client History, and minimal read-only Settings.
- Preserved lawyer-side Matters, Firm Library, Assistant, History, Work Products, Firm Settings, collaboration management, sharing decisions, and stop-sharing behavior.

Schema changes:

- Migration 022, `authenticated_client_workspace`, additively creates `users.account_type` with existing accounts backfilled to `lawyer`, stores the requested account mode with OTP challenges, adds nullable `matter_client_access.claimed_by_user_id`, and adds supporting indexes.
- No existing user, Firm, Matter, document, message, Work Product, request, response, or collaboration record is reset, renamed, recreated, or copied.

Dependencies added or changed:

- None.

Verification:

- Focused Client Workspace and portal reliability tests: passed, 30/30.
- `npm run lint`: passed.
- `npm test`: passed, 136/136 tests.
- `npm run build`: passed with the existing Vite environment and large-chunk warnings.

Known limitations:

- Client profile editing, notifications, billing, account deletion, and email invitation delivery remain intentionally outside this phase.

## Client Collaboration Tokens and Assistant Documents

Status: Complete.

Implemented:

- Replaced active collaboration-link generation and deep-link claiming with 128-bit opaque `MAT-…` collaboration tokens. Lawyers see the plaintext only when it is generated, copy only that token, and continue to store only its SHA-256 hash on the existing collaboration record.
- Added token-only redemption inside Add Shared Matter. Redemption trims outer whitespace, rejects URLs, locks and validates the existing collaboration transactionally, remains idempotent for its claimed client, and updates the Shared Matters list without a page reload.
- Preserved active pre-feature invitation records: their existing raw token remains hash-compatible for redemption, while complete URLs and browser deep-link claiming are no longer accepted by the active Client Workspace.
- Added a client Assistant document picker grouped by Shared Matter, with removable per-message selections and stored selection metadata.
- Added session-derived document allow-listing and per-message reauthorization. Only Work Products explicitly shared with the client or attached to a lawyer request in an active claimed collaboration can supply content.
- Added bounded relevant-passage selection and grounded Gemini prompting through the existing client Assistant model path, document-title references where supported, and an explicit insufficient-evidence response.
- Preserved the existing authenticated Client Workspace, shared-document previews/downloads, requests/responses/uploads, lawyer collaboration management, token rotation, and immediate stop-sharing revocation.

Schema changes:

- None. Migration 022, `authenticated_client_workspace`, already provides the nullable claimed client, unique collaboration token hash, active/revoked state, and one-collaboration-per-Matter relationship required by both features.

Dependencies added or changed:

- None.

Verification:

- Focused collaboration-token and client-document tests: passed, 22/22.
- Full lint, test, and production build results are recorded in the completing commit report.

Known limitations:

- Collaboration-token expiration is not part of the existing product schema, so tokens remain valid until rotation, revocation, or claim by the intended client.

## Collaboration Token Redemption Repair

Status: Complete.

- Collaboration tokens now act as the invitation credential for an authenticated Client account; the lawyer-entered email remains contact metadata and no longer restricts redemption.
- The first valid claimant is stored on the existing collaboration, same-client redemption remains idempotent, and another client cannot take over the claim.
- Explicit lawyer revocation now detaches the claimed client account, while active token regeneration preserves the current claim.
- No schema, migration, token generation, token hashing, parsing, authentication, Shared Matter authorization, or Client Assistant behavior changed.

## Persistent Client Work Product Revisions

Status: Complete.

- Clients can create editable Client Revisions from shared Work Products in the persistent Shared Matters interface.
- Each revision is stored as a separate existing Matter draft; the lawyer’s original remains unchanged.
- Comments remain deferred and were not changed.

## Persistent Workspace Uploads

Status: Complete.

Implemented:

- Added a 25-file frontend selection limit used only by Firm Library uploads, Matter Source uploads, and optional files selected while creating a Matter. The existing five-file default remains in place for Assistant and client-facing attachment flows.
- Added one reusable sequential upload helper with ordered processing, per-file progress, stable browser-file identities, separate success and failure results, and no automatic retries or concurrent requests.
- Firm Library and Matter Source uploads now send exactly one file per request, continue after an individual failure, remove only successful files from the pending selection, retain failed files for manual retry, show filename-specific server errors, and refresh their document lists after processing.
- Matter Source custom titles remain available only when the operation starts with exactly one selected file; multi-file operations continue to use filenames.
- Matter creation retains the existing request path for zero to five files. With more than five files, it creates one Matter without browser files, then uploads each optional source sequentially through the existing Matter Source endpoint and opens the created Matter even when an optional source fails.
- Upload controls and pending-file removal are disabled while a persistent operation is running to prevent duplicate or conflicting submissions.

Schema changes:

- None.

Server and isolation safeguards:

- No server code changed. Multer remains memory-backed and `MAX_FILE_COUNT = 5`, `MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024`, and `MAX_TOTAL_EXTRACTED_CHARS = 120_000` remain unchanged.
- Existing authentication, Firm ownership, Matter ownership, portal token validation, MIME/extension validation, extraction, chunking, embedding, and tenant-isolation paths remain unchanged.

Dependencies added or changed:

- None.

Tests:

- Added behavioral coverage for the 25-file persistent limit, the five-file restricted default, duplicate prevention, strictly sequential execution, one-file FormData requests, failure continuation, successful-file preservation, failed-file retry results, server error propagation, and unchanged backend ceilings.
- Updated workflow regressions for the three persistent views, one-file custom-title behavior, more-than-five Matter creation, single-Matter creation, post-creation source failure reporting, restricted Assistant/client limits, and unchanged authorization paths.

Verification:

- Focused persistent-upload and related regression tests: passed, 69/69.
- `npm run lint`: passed.
- `npm test`: passed, 156/156 tests.
- `npm run build`: passed with the existing Vite `NODE_ENV` and large-chunk warnings.
- `npm run verify`: passed, including lint, 156/156 tests, and the production build.

Manual checks:

- Browser-driven upload and cross-tenant smoke checks were not run because this environment did not provide an authenticated browser session or disposable database data. Automated isolation and upload-path regressions passed.

## Private-Preview Site Lock

Status: Complete.

Implemented:

- Added a server-only private-preview policy configured by `SITE_LOCKED`, `SITE_REOPENS_AT`, and `SITE_ALLOWED_EMAILS`, with case-insensitive trimmed email matching and fail-closed empty or malformed allowlists.
- Enforced the policy before Google account creation, OTP issuance and verification, session establishment, session restoration, every existing protected API path, and direct protected SPA page access.
- Added a sanitized no-store public status endpoint that exposes only the lock state and normalized countdown date; approved email addresses remain absent from frontend source and build output.
- Added a responsive white, black, and grayscale coming-soon screen with safe days, hours, minutes, and seconds countdown behavior, a generic missing/invalid-date state, and a discreet Private access link to the existing authentication page.
- Preserved normal authentication, routing, and API behavior when the lock is disabled. Countdown expiry does not unlock the application.

Schema changes:

- None.

Dependencies added or changed:

- None.

Verification:

- Focused private-preview tests: passed, 11/11.
- `npm run lint`: passed (`tsc --noEmit`).
- `npm test`: passed, 167/167 tests.
- `npm run build`: passed with the existing Vite `NODE_ENV` and large-chunk warnings.
- Diff review confirmed fixed internal redirects, normalized email comparisons, server-side session/API enforcement, and no allowlist content in frontend source or the production frontend bundle.

Manual checks:

- Live Google OAuth, Brevo OTP delivery, browser-responsive rendering, and authenticated production database sessions were not exercised because this environment did not provide disposable provider credentials, a browser session, or a disposable production database. The focused policy/wiring tests, full regression suite, TypeScript check, and production build passed.

### Default-Locked Configuration Follow-up

- Changed private preview to fail closed by default: an unset or non-`false` `SITE_LOCKED` value keeps the site locked, and only an explicit case-insensitive `false` restores public access.
- Aligned `.env.example`, deployment guidance, and focused regression coverage with the default-locked behavior.
- No authentication flow, route enforcement, schema, dependency, account, session, or production data behavior changed beyond the lock default.
- Verification passed: 11/11 focused tests, `npm run lint`, 167/167 full tests, and `npm run build` with the existing Vite warnings.

## Lawyer Workspace Redesign — Phase 1

Status: Complete.

Implemented:

- Replaced the lawyer sidebar with a persistent, full-height assistant panel and a lawyer-only top navigation containing Matters, Firm Library, and History.
- Added pointer and keyboard resizing, viewport-safe width clamping, and saved width restoration through `exepts.assistantPanelWidth`.
- Added a compact assistant header with the Exepts and Firm identity, current context, and New conversation action.
- Added the lawyer profile footer and account menu with Settings and Log out; Settings continues to render in the main workspace.
- Changed authenticated and onboarded lawyer defaults to `/matters`; `/assistant` remains parseable and return-to safe but redirects authenticated lawyers to Matters.
- Kept the client workspace and its navigation branch unchanged.
- Replaced the full-page assistant empty state with a compact panel state and made the response editor an overlay.
- Removed the obsolete lawyer `Sidebar.tsx` after confirming there were no remaining imports.

Schema changes:

- None.

Tests:

- Added focused routing, top-navigation, profile-menu, persistent-panel, resize accessibility, stored-width clamping, compact-empty-state, client-shell preservation, and legacy-assistant-bookmark coverage.
- Updated prior source-level regressions that intentionally referenced the retired lawyer sidebar or old lawyer default route.

Verification:

- `npm ci`: passed.
- `npm run verify`: passed after the Phase 1 changes.

## Lawyer Workspace Redesign — Phase 2

Status: Complete.

Implemented:

- Removed the manual General Assistant/Matter selector. The route now determines a General or Matter conversation boundary, and the browser keeps a separate active thread ID for each boundary during the session.
- Added a typed page-context provider and published current page, active Matter tab, selected Source/Work Product/Library document, and concise visible-action descriptions from Matters, Matter workspace, Firm Library, History, and Settings.
- Added shared page-context sanitization with route and item allowlists, control-character cleanup, field-length bounds, a 12-action ceiling, and unknown-field removal.
- Revalidated submitted Matter, thread, selected Source, Firm Library document, and Work Product identifiers against the authenticated user/Firm and the thread's authoritative `case_id` before any message is saved.
- Added deterministic `ui_help`, `general`, `workspace_research`, `deep_research`, and reserved `draft` request routing. UI help and ordinary general chat return before vector retrieval; complex authorized workspace questions retain Deep Research and citation handling.
- Preserved strict Matter retrieval and evidence-insufficiency behavior for workspace research while allowing ordinary general questions to use normal model capability without an internal-document refusal.
- Kept Google grounding opt-in, request-scoped attachments, canonical citations, streaming, conversation titles, and dynamic follow-ups.
- Made Improve task-aware using the sanitized current page and response mode, and made loading activity text reflect the routed request instead of always claiming an internal-source review.
- History now loads a selected Matter conversation in that Matter and loads a General conversation in the persistent panel without navigating to `/assistant`.

Schema changes:

- None.

Tests:

- Added behavioral tests for sanitization bounds, request routing, page/thread boundary validation, automatic context-specific thread state, server-side selected-entity revalidation, UI/general no-vector paths, retained workspace insufficiency language, page publishers, and task-aware Improve.
- Updated brittle tests that intentionally encoded the retired manual scope selector, unconditional research activity, classifier wording, or exact metadata object shape.

Verification:

- `npm ci`: passed.
- `npm run verify`: passed after the Phase 2 changes.

## Lawyer Workspace Redesign — Phase 3

Status: Complete.

Implemented:

- Added an explicit Draft mode to the persistent assistant composer. Draft requests now infer contracts, agreements, letters, briefs, reports, policies, summaries, emails, memoranda, and other reasonable document types from the user's instruction instead of using the retired three-format modal.
- Removed the post-response Generate Draft action and made the message request's typed `responseMode` select chat or document creation before submission.
- Added one server drafting flow that reuses authenticated page/thread validation, Matter or Firm retrieval where appropriate, temporary attachments, opt-in Google grounding, Deep Research decomposition, generated-content cleanup, and the existing model provider.
- Matter Draft mode saves through the existing Matter Work Product table and ownership path. General Draft mode saves through a separate private standalone assistant-document path.
- Added persisted assistant message document metadata and compact Open/Download cards. Matter cards open the correct Matter Work Product tab; standalone cards open `/documents/:documentId` without hiding the assistant.
- Added a shared rich document editor surface used by Matter Work Product and standalone assistant documents, with live rich editing, read-only preview, save state, update information, and real Word export.
- Added server-side validation of selected standalone assistant-document IDs and exact authenticated user-and-Firm checks on standalone fetch, update, and export.
- Kept the legacy three-format `/api/drafts` API for backward compatibility only; the new composer flow does not call it.
- Kept the client workspace and existing Matter client-sharing behavior unchanged. Standalone assistant documents are private, are not added to Firm Library, and cannot be shared with clients in this phase.

Schema changes:

- Migration 023 additively creates `assistant_documents` with nullable `thread_id ... ON DELETE SET NULL`, required `user_id` and `firm_id`, title/content/timestamps, an owner/update index, and a partial thread lookup index.
- Conversation deletion therefore preserves standalone assistant documents while clearing only their conversation reference.

Tests:

- Added behavioral tests for arbitrary document-type routing, Draft evidence routing, title extraction, standalone route parsing, and genuine DOCX package generation.
- Added focused regressions for pre-submit Draft mode, removal of the old Generate Draft/modal UI, Matter versus standalone persistence selection, persisted document cards, additive migration safety, thread-deletion survival, exact user/Firm ownership predicates, selected-document revalidation, shared editor reuse, export endpoints, and absence of Firm Library/client-sharing side effects.
- Updated brittle Work Product presentation and Assistant activity tests to follow the shared editor and pre-submit Draft mode.

Verification:

- `npm ci`: passed.
- `npm run verify`: passed, including TypeScript lint, 191/191 tests, and the production build with the existing Vite `NODE_ENV` and large-chunk warnings.

Deliberate limitations:

- Standalone assistant documents remain private to their creating lawyer and do not have Firm or client sharing controls.
- The legacy memo/email/summary endpoint remains temporarily available for backward compatibility, but no current lawyer UI depends on it.

## Lawyer Cloud File Selection

Status: Complete.

Implemented:

- Added a shared lawyer-only file-source picker that always offers Device and conditionally offers Google Drive and Dropbox when their browser picker identifiers are configured.
- Added lazy, deduplicated loading for Google Identity Services, Google Picker, and Dropbox Chooser without adding runtime dependencies.
- Added in-memory Google `drive.file` authorization, Google Drive byte downloads, and native Google Docs export to DOCX. Tokens, selected file IDs, and download URLs are not stored or sent to Exepts.
- Added Dropbox Chooser direct-link downloads without Dropbox OAuth. Direct links and selected item IDs are discarded after conversion.
- Converted cloud selections to ordinary browser `File` objects with safe names, accepted MIME types, 10 MB and empty-file checks, sequential downloads, partial-success handling, and stable provider-derived file identity.
- Integrated cloud selection with Assistant temporary extraction, Matter Sources, optional Create Matter files, and Firm Library while preserving the existing cumulative limits and upload flows.
- Kept Device upload available and left all client portal upload surfaces unchanged.

Schema changes:

- None.

Dependencies:

- None added. The official provider browser scripts are loaded only after the corresponding user action.

Tests:

- Added focused coverage for provider availability, script deduplication, Google scope and memory-only tokens, Google and Dropbox conversion, native Google Docs export, unsupported Workspace types, size and empty-file validation, partial success, cumulative limits, stable duplicate identity, and the four lawyer integration paths.
- Updated source-level upload tests only where the shared file-source picker intentionally replaces local-only input markup.

Verification:

- `npm run verify`: passed, including TypeScript lint, 204/204 tests, and the production build with the existing Vite `NODE_ENV` and large-chunk warnings.
- Live Google Drive and Dropbox popup/account verification was not available in the non-interactive implementation environment.

Deliberate limitations:

- This is immediate browser-side selection, not synchronization or a persistent connector.
- Google Sheets, Google Slides, Dropbox Paper, folders, OneDrive, offline access, and background imports are not supported.
- Live provider popup verification requires configured provider applications and interactive Google/Dropbox accounts.

## Persistent Lawyer Assistant Corrective Patch

Status: Complete.

Implemented:

- Replaced the route-keyed General/Matter active-thread map with one session-only `activeThreadId`. Fresh loads start empty, navigation leaves the selected conversation unchanged, History remains the only conversation discovery surface, and New conversation clears the transcript and temporary composer state without creating a database thread.
- Removed Assistant thread-list initialization and newest-thread fallback behavior. Messages load only for an explicitly active thread, with abort/sequence guards preventing stale conversation loads or response streams from overwriting a later selection.
- Preserved History grouping and navigation semantics. A new thread keeps the Matter where it originated as `case_id` metadata, but that association no longer controls the current page, retrieval, selected-entity authorization, or Draft destination.
- Made the sanitized current-page snapshot mandatory for lawyer Ask and Draft requests. The server independently validates the current Matter and selected Source, Firm Library document, Work Product, Matter, or standalone assistant document against the authenticated user and Firm before saving the message or performing retrieval.
- Changed all lawyer Assistant retrieval, citation labels, drafting evidence, Matter metadata, and document destination decisions to use the server-validated current Matter. Non-Matter pages use Firm Library scope and cannot retrieve a Matter merely because the conversation originated there.
- Persisted sanitized page context alongside attachment filenames in lawyer user-message metadata and added concise historical page labels to bounded prior-conversation prompts. UI help, general chat, workspace research, and Draft prompts now all receive appropriate current-page context and prior conversation.
- Expanded deterministic current-page help recognition, including the exact Settings question, while leaving unrelated requests such as general Windows settings explanations in ordinary chat.
- Added bounded page descriptions and visible-section metadata, with URL/secret-shaped text scrubbing, and enriched Matters, individual Matter tabs, Firm Library, History, Settings, and standalone assistant-document publishers. Settings publishes role-aware Account, Firm administration/details, and Session descriptions without the invitation-code value.
- Removed the Assistant Improve button and manual Deep Research toggle while retaining automatic deep-research routing, historical research-step rendering, Research sources, Web Search, Device/Google Drive/Dropbox attachments, Draft mode, and Ask/Create Draft.
- Restored Settings as the fourth top-navigation item and removed the assistant-panel account/profile footer. Settings-page logout remains available.
- Preserved the client workspace, authentication model, `.docx` generation, citations, streaming, document editors, existing conversation records, and cloud upload paths.

Schema changes:

- None. No migration was added.

Tests:

- Updated rejected route-keyed-thread expectations and older Improve/Deep Research UI assertions.
- Added focused coverage for the single fresh active-thread model, lazy thread creation, navigation persistence, explicit History selection, stale message-load protection, current-page Matter derivation, context sanitization and historical labels, exact Settings UI-help routing, current-page selected-entity and retrieval scoping, role-aware Settings context, and current-page Draft persistence independent of thread origin.
- Existing isolation, cloud file selection, Draft/Word generation, History, authentication, and client workspace regressions remain passing.

Verification:

- `npm run lint`: passed.
- `npm run build`: passed after rerunning outside the filesystem sandbox; the sandboxed attempt could not resolve `vite.config.ts` because parent-directory reads were denied.
- `npm run verify`: passed, including TypeScript, 207/207 tests, and the production build.
- Existing Vite warnings remain for `.env` `NODE_ENV=production` handling and the JavaScript chunk exceeding 500 kB.

Manual verification not available:

- Interactive browser navigation with a live authenticated database and live Google Drive/Dropbox provider popups was not available in the non-interactive implementation environment.

Deliberate limitations:

- Active assistant state intentionally resets on a full browser refresh and is not stored in browser storage or a URL.
- Existing `thread.case_id` and `thread.scope` values remain unchanged for History grouping and backward compatibility.
- The legacy Improve endpoint and backward-compatible server handling for `forceDeepResearch` remain available to internal callers, but the lawyer Assistant UI no longer invokes them.

## Legal LLM Plus — Phase 1: One Assistant Core

Status: Complete.

Implemented:

- Added one permanent lawyer-assistant charter and supplied it through Gemini `systemInstruction` for lawyer Assistant planning, answering, research synthesis, and Draft generation.
- Added strict typed assistant intents, depths, read-only tool-call shapes, session context, evidence records, prompt builders, and adaptive response temperature policy.
- Replaced authoritative endpoint use of the frontend regex router with a structured server planner using the lighter Gemini model, JSON response schema, strict runtime validation, deterministic Draft planning, and a conservative no-model fallback.
- Built authenticated server session context from the account and server-validated current Matter while excluding invitation codes, session data, OAuth data, cloud links, tokens, and other secrets.
- Wrapped retrieved and supplied content in an explicit untrusted evidence boundary with control-character and nested-boundary sanitization.
- Removed the mandatory exact missing-document refusal and restored normal general legal knowledge while requiring private Matter facts to remain grounded and current law to be described as unverified when live search is not used.
- Preserved the existing request-mode response metadata for frontend compatibility and added the server intent as additional metadata.

Schema changes:

- None in Phase 1.

Tests:

- Added planner, validator, permanent-charter, deterministic Draft, general/legal/product/workspace fallback, disabled-web, and prompt-injection boundary tests.
- Updated legacy assertions that required the retired exact document refusal or the old metadata-only shape.

Verification:

- `npm run lint`: passed via `npm.cmd` (PowerShell script execution is disabled on this host).
- `npm test`: passed, 214/214 tests.
- `npm run build`: passed outside the filesystem sandbox after the sandboxed Vite config load was denied by host permissions.
- Existing Vite warnings remain for `.env` `NODE_ENV=production` handling and the JavaScript chunk exceeding 500 kB.

Deliberate Phase 1 boundary:

- The typed tool names are planner-visible, but their server-only execution registry is implemented in Phase 2.
- Hybrid retrieval and rolling thread memory are implemented in Phase 3.

## Legal LLM Plus — Phase 2: Authorized Read-Only Workspace Tools

Status: Complete.

Implemented:

- Added a server-only registry and bounded executor for exactly these read-only capabilities: `get_account_profile`, `get_firm_summary`, `list_matters`, `find_matter`, `get_matter_overview`, `list_matter_sources`, `get_matter_intelligence`, `list_matter_work_products`, `get_work_product`, `get_matter_collaboration_summary`, `list_firm_library_documents`, `get_firm_library_document`, `search_workspace_documents`, `list_assistant_documents`, `get_assistant_document`, `search_conversation_history`, and `get_conversation`.
- Kept tool execution internal to the authenticated lawyer message endpoint; no browser-callable arbitrary tool API was added.
- Enforced eight attempted calls, two non-current Matters, 50 Matter rows, 25 document rows, 12 passages, bounded History, per-record truncation, and a 26,000-character total evidence budget.
- Made current-Matter access server-authoritative and rejected forged non-current Matter IDs before database access. Explicit named Matter resolution is conservative, bounded to owned Firm Matters, and produces one focused clarification for ambiguous matches.
- Added safe Firm summary, owned assistant-document listing, and owned non-client conversation search DB methods. Every query is scoped by authenticated user and/or Firm as required.
- Sanitized account, Firm, Matter, Source, Intelligence, Work Product, Collaboration, Firm Library, assistant-document, and History results. Collaboration omits portal/access IDs, token hashes, and authentication data; document results omit provider links and IDs; secret-shaped text is redacted before prompting.
- Connected tool evidence to the unified response and Draft paths with provenance-aware citations for material records. The existing Draft creation operation remains the only Assistant write behavior.
- Replaced speculative pre-plan activity messages with neutral context/response preparation text.

Schema changes:

- None in Phase 2.

Tests:

- Added registry, account-secret exclusion, forged Matter rejection, current-Matter authorization, Collaboration secret stripping, call-budget, evidence-redaction, and scoped-context tests.
- Updated the loading-activity regression to enforce neutral language before server planning is known.

Verification:

- `npm run lint`: passed via `npm.cmd`.
- `npm test`: passed, 220/220 tests.
- `npm run build`: passed outside the filesystem sandbox because Vite requires parent-directory access on this host.
- Existing Vite warnings remain for `.env` `NODE_ENV=production` handling and the JavaScript chunk exceeding 500 kB.

Deliberate Phase 2 boundary:

- Document passage search still calls the existing semantic search implementation; hybrid ranking and retry replace that path in Phase 3.
- Rolling conversation summaries and their additive migration are implemented in Phase 3.

## Legal LLM Plus — Phase 3: Hybrid Retrieval and Rolling Memory

Status: Complete.

Implemented:

- Added Firm- and Matter-scoped PostgreSQL keyword/title passage search alongside the existing Gemini embedding search.
- Added understandable hybrid reranking across exact title, partial title, keyword overlap, semantic similarity, and selected-document preference; results are deduplicated and weak unrelated candidates are excluded without using the former 0.65 semantic cutoff as the sole existence test.
- Added dynamic passage limits: four for brief lookup, eight for standard analysis, ten for standard Draft evidence, and twelve for thorough analysis.
- Added direct authorized selected-document chunk retrieval and one optional weak-result query reformulation/retry. Retry never changes the original Firm Library or Matter scope and cannot loop.
- Routed the Assistant document-search tool and Draft evidence gathering through hybrid retrieval. The previous Draft-only fixed semantic lookup was removed.
- Added bounded rolling thread memory using the lighter Gemini model. Initial summary begins at 16 messages or 18,000 recent characters and refreshes after eight more messages.
- Memory captures durable references, goals, confirmed facts, conclusions, preferences, terms, decisions, open questions, and unfinished tasks. It is capped at 6,000 characters, secret-redacted, treated as continuity rather than evidence, and combined with a bounded recent-message window.
- Memory generation and persistence are best-effort: either may fail without failing the user request. Existing messages remain intact and History behavior is unchanged.

Schema changes:

- Added migration 24, `lawyer_assistant_thread_memory`:
  - `threads.memory_summary TEXT`
  - `threads.memory_message_count INTEGER NOT NULL DEFAULT 0`
  - `threads.memory_updated_at TEXT`
- The migration is additive, repeatable through `IF NOT EXISTS`, and does not rewrite or delete messages.

Tests:

- Added exact-title, semantic, keyword, deduplication, dynamic-depth, one-retry/same-scope, memory threshold, refresh cadence, secret redaction, summary failure fallback, and additive migration tests.
- All existing History, Draft/Word, authentication, isolation, cloud upload, client workspace, Collaboration, and document presentation regressions remain passing.

Verification:

- `npm run lint`: passed via `npm.cmd`.
- `npm test`: passed, 226/226 tests.
- `npm run build`: passed outside the filesystem sandbox because Vite requires parent-directory access on this host.
- Existing Vite warnings remain for `.env` `NODE_ENV=production` handling and the JavaScript chunk exceeding 500 kB.

Manual verification not available:

- Live authenticated browser flows with populated Matter/Collaboration/History data and live Gemini/Google Search grounding were not available in the non-interactive implementation environment.
- Live Google Drive and Dropbox picker/account flows were not repeated; their automated regression coverage remains passing and those paths were not modified.

Deliberate limitations:

- Retrieval uses lightweight PostgreSQL keyword matching and transparent local reranking; no new search service or extension was added.
- Rolling memory is conversation-scoped and is not persistent user-profile memory or an independent source of private facts.

## Professional Word/DOCX Generation Repair

Status: Complete.

Implemented:

- Replaced the shared line-by-line Markdown converter with a typed, export-only normalization, block parsing, inline parsing, and DOCX rendering pipeline behind the unchanged `markdownToDocxDocument(title, markdown)` façade.
- Removed consecutive opening title duplicates in memory without rewriting stored content, normalized line endings and blank space, omitted thematic breaks, and unwrapped accidental whole-document Markdown fences.
- Added soft-wrapped paragraph joining with explicit hard-break preservation; H1-H6 and conservative legal heading recognition; bounded nested lists with independent ordered-list numbering and authored starts; blockquotes; code blocks; and safe fallback behavior for malformed tables and inline syntax.
- Added real GFM tables with repeating neutral header rows and conservative two-column signature-table treatment. Signature drafting blanks remain verbatim.
- Added typed inline bold, italic, underline, code, safe `http:`, `https:`, and `mailto:` hyperlinks, including actual external Word hyperlink relationships. Unsupported schemes remain ordinary text.
- Added US Letter sizing, 0.9-inch margins, Arial title/body/heading styles, legal heading pagination controls, an unobtrusive title header omitted on the first page, dynamic `Page X of Y` fields, and page breaks for signature sections, exhibits, schedules, appendices, and annexes.
- Kept all five existing Matter Work Product, standalone assistant-document, client, legacy client portal, and Matter Intelligence routes on the shared renderer without route changes.

Schema changes:

- None. No migration was added and no stored document row was changed.

Dependencies:

- Added `jszip` 3.10.1 as a direct development-only dependency. The same version was already present transitively through `docx` and `mammoth`; it is used only to inspect generated Word XML, relationships, numbering, tables, headers, and footer fields in tests.

Tests:

- Added nine focused tests covering duplicate titles, subtitles, outer fences, line and blank handling, hard breaks, H1-H6 and legal headings, thematic breaks, independent list restarts and authored starts, bounded nesting, safe inline formatting and links, preserved drafting blanks, GFM and signature tables, malformed-table fallback, signature/exhibit page breaks, DOCX styles, page fields, first-page header behavior, packed-DOCX readability through Mammoth, and continued shared-renderer route use.
- Existing authentication, Matter isolation, Work Product, assistant-document, client, Matter Intelligence, drafting, and presentation regressions remain passing.

Verification:

- `npm run lint`: passed via `npm.cmd`.
- `npm test`: passed, 235/235 tests.
- `npm run build`: passed outside the filesystem sandbox because Vite requires parent-directory access on this host.
- `npm run verify`: passed outside the filesystem sandbox for the same Vite requirement.
- Existing Vite warnings remain for `.env` `NODE_ENV=production` handling and the JavaScript chunk exceeding 500 kB.

Manual verification not available:

- Microsoft Word, LibreOffice, and another compatible interactive Word viewer were not installed in this non-interactive environment. Automated validation packed representative DOCX files in memory, read them with Mammoth, and inspected their Word XML for real tables, hyperlink relationships, numbering definitions, pagination controls, first-page headers, and dynamic page fields.

Deliberate phase boundary:

- Draft prompts, model selection, evidence gathering, stored wording, cleanup behavior, database content, frontend Preview, frontend Editor, authentication, uploads, and collaboration were not changed.
- This focused parser covers the Markdown structures Exepts generates and intentionally does not attempt full CommonMark compatibility. Browser Preview and Editor presentation remain separate follow-up work.

## Compact Assistant UI/UX — Phase 1: Minimum Default Width

Status: Complete.

Implemented:

- The Assistant now defaults to its existing 360px minimum width when no valid saved width is available.
- Saved user-selected widths are still restored and clamped normally.
- Pointer and keyboard resizing, local-storage persistence, maximum-width behavior, and narrow-screen clamping were preserved.
- No backend, schema, dependency, or Assistant-processing changes were made.

Verification:

- Focused Assistant panel test: passed, 17/17 tests.
- `npm run lint`: passed via `npm.cmd`.
- `npm test`: passed, 240/240 tests.
- `npm run build`: passed outside the filesystem sandbox because Vite requires parent-directory access on this host.
- The existing Vite warning for a JavaScript chunk exceeding 500 kB remains.

## Compact Assistant UI/UX — Phase 2: Progressive Activity Display

Status: Complete.

Implemented:

- Replaced the rotating single status with a forward-only progressive activity block that stops at its final stage.
- Completed stages remain visible with static grayscale checkmarks while only the current stage pulses.
- Attachment review is inserted only for requests with temporary attachments, and Draft requests use document-specific preparation and refinement wording.
- Active pulsing respects reduced-motion preferences, and the compact rows wrap safely within the Assistant panel.
- The activity block disappears as soon as response streaming begins.
- Assistant reasoning, retrieval, request handling, payloads, and response streaming behavior were unchanged.
- No backend, schema, dependency, or API changes were made.

Verification:

- Focused Assistant activity tests: passed, 14/14 tests.
- `npm run lint`: passed via `npm.cmd`.
- `npm test`: passed, 245/245 tests.
- `npm run build`: passed outside the filesystem sandbox because Vite requires parent-directory access on this host.
- The existing Vite warning for a JavaScript chunk exceeding 500 kB remains.

Manual verification not available:

- The authenticated application and browser local-storage controls were not available in this non-interactive environment. The width persistence/reload and live normal, attachment, Draft, streaming-transition, 360px overflow, and reduced-motion checks remain outstanding.

## Gemini Model Standardization

Status: Complete.

Implemented:

- Standardized substantive legal and user-visible generation on `gemini-3.6-flash`, lightweight structured and internal work on `gemini-3.5-flash-lite`, and embeddings on `gemini-embedding-2`.
- Added centralized task thinking defaults plus the confirmed adaptive and call-specific overrides for Assistant, research, and Draft work.
- Removed deprecated temperature sampling from the shared model layer and all production Gemini call sites without adding replacement sampling parameters.
- Preserved the existing `generateContent` and `embedContent` architecture, Google Search opt-in conditions, grounding metadata and citation processing, retry behavior, and sanitized errors.
- Kept embeddings at 768 dimensions with unchanged input formatting and no re-embedding.

Schema changes:

- None. No database or migration changes were made.

Tests:

- Added focused deterministic coverage for exact model assignments, thinking defaults and overrides, adaptive Assistant thinking, unchanged embeddings, and the absence of deprecated sampling configuration in production generation code.

Verification:

- `npm ci`: passed via `npm.cmd`.
- `npm run verify`: passed outside the filesystem sandbox because Vite requires parent-directory access on this host.
- TypeScript lint/type checking passed, all 250 tests passed, and the production Vite/esbuild build passed.
- The existing Vite warning for a JavaScript chunk exceeding 500 kB remains.

## Professional Word/DOCX Generation — Table and Layout Standardization

Status: Complete.

Implemented:

- Added a framework-neutral canonical compiler under `shared/document/`. It normalizes an export copy of the persisted Markdown, parses a standards-based GFM AST into typed semantic blocks, applies conservative legal-heading and pagination rules, plans tables, and returns non-sensitive diagnostics. The stable `markdownToDocxDocument(title, markdown)` façade now compiles once and passes that result to the Word renderer; compatibility modules only re-export the canonical implementation.
- Replaced handwritten block interpretation with direct `unified` 11.0.5 and `remark-parse` 11.0.0 dependencies plus the existing `remark-gfm` pipeline. Supported structures include H1-H6, soft and hard breaks, safe inline formatting and links, bounded lists with authored starts, blockquotes, code, GFM tables, alignment markers, safe `<br>` and `<u>`, and readable unsupported-HTML fallback.
- Centralized the semantic document theme and Letter page constants. DOCX remains Arial, grayscale, US Letter, with 0.9-inch margins, first-page header suppression, subsequent title headers, and continuous `Page X of Y` fields.
- Added deterministic column classification and sizing from header/body lengths, median and average content, longest tokens, hard breaks, empty-cell share, numeric/date/status patterns, prose density, and column count. Positive normalized weights are bounded, then converted by largest-remainder rounding so grid widths exactly equal the portrait or landscape content width.
- Added readability-based wide-table classification. Portrait remains the default; only tables whose calculated minimum readable widths exceed portrait capacity and also have sufficient column/prose density move to a new landscape section. Normal content returns to portrait, and an immediately preceding heading can move with its wide table.
- Ordinary tables now emit explicit DXA table, grid, and cell widths with autofit layout, repeated nonsplitting header rows, authored or conservatively inferred paragraph alignment, grayscale borders/shading, cell margins, and 8.5–10 pt table-specific typography. Recognized two-party signature tables remain portrait, borderless, unshaded, and fixed at 50/50.
- Row pagination is deterministic: headers never split; short compact rows and short signature rows remain together; long prose-heavy rows may split; and table-cell paragraphs do not use `keepLines`. This prevents substantial rows from forcing avoidable blank page areas.
- Added conservative malformed-table normalization for missing/inconsistent outer pipes, two-dash separators, empty headers, missing trailing cells, extra empty trailing cells, escaped literal pipes, alignment colons, and `<br>`. Ambiguous structures become labelled readable paragraphs without raw separator or pipe rows. Diagnostics never include source text, IDs, authentication data, or Matter data and are not stored, logged, or returned to clients.
- Added shared export-safe GFM drafting rules to Assistant document drafting, Work Product generation, and Matter Intelligence generation without changing model IDs, thinking, grounding, retrieval, evidence, metadata, citation, uncertainty, disclaimer, or exact Matter Intelligence heading requirements.
- Added representative Markdown fixtures, compiler/layout/prompt/XML/route regression coverage, and `npm run docx:fixtures`, which generates review documents through the real façade into gitignored `tmp/docx-review/` without Gemini, database access, or user data.

Dependencies:

- Added `unified` 11.0.5 and `remark-parse` 11.0.0 as the minimum direct parsing dependencies. Both integrate with the existing direct `remark-gfm` dependency; no conversion framework or remote service was added.

Schema and phase boundary:

- No schema or migration changes. Markdown remains the persisted format and no stored document was rewritten.
- No changes to frontend Preview, Editor, document styling, `FormattedMarkdown`, `WorkProductDocument`, `RichDocumentEditor`, or `richMarkdown.ts`.
- All five existing export paths retain the shared façade and their existing authentication, ownership, cleanup, filename, header, and route behavior.

Verification:

- `npm ci`: could not complete because Windows returned `EPERM` while unlinking the in-use `lightningcss.win32-x64-msvc.node` binary. The partially removed tree was repaired with the permitted lockfile-consistent `npm install`; `npm ls --depth=0` then passed. No dependency version was changed to bypass the host error.
- `npm run lint`: passed (`tsc --noEmit`).
- `npm test`: passed, 259/259 tests.
- `npm run build`: passed with the established parent-directory filesystem permission required by Vite on this host. The existing JavaScript chunk-size warning remains.
- `npm run docx:fixtures`: passed and generated 16 gitignored review files under `tmp/docx-review/`.
- `npm run verify`: passed; lint, all 259 tests, and the production Vite/esbuild build completed successfully.

Outstanding manual review:

- Microsoft Word checks for the memorandum, signature agreement, long prose table, landscape transition, repair warnings, row pagination, repeating headers, clipping/overlap, avoidable blank space, and editability remain outstanding until performed in an interactive Word environment.
- A secondary Word Online or LibreOffice compatibility check remains outstanding.

## Professional Document Preview and Editing — Phase 2

Status: Complete.

Checkpoint A — canonical preview:

- Formal read-only documents now compile through `compileDocument(title, content)` and render typed `CompiledDocument` blocks directly. The preview does not use `react-markdown`, browser regex parsing, raw HTML, or `dangerouslySetInnerHTML`.
- Extracted DOCX orientation grouping into the framework-neutral `groupDocumentSections` helper. The existing landscape-table grouping and immediately-preceding-heading move are unchanged, and the Word renderer now consumes that helper without changing page dimensions, margins, headers, footers, numbering, transitions, or table behavior.
- Extended the shared document theme with semantic browser typography, spacing, page, border, link, and background values while retaining all existing Word-facing values.
- Added physical US Letter portrait and landscape paper canvases with 0.9-inch content margins, horizontal overflow, grayscale borders/shadows, explicit page/orientation separation, and no simulated page numbers or automatic pagination.
- Added direct renderers for H1–H6, paragraphs, ordered and unordered nested lists with authored starts, blockquotes, code blocks, page breaks, safe links, combined inline marks, hard breaks, ordinary tables, signature tables, and wide tables.
- HTML tables consume canonical widths, alignments, column kinds, layout, orientation, signature classification, header rows, and content. Column percentages use deterministic largest-remainder rounding to total exactly 100%.
- `WorkProductDocument` remains the compatibility façade and now requires the real title. Work Product, Assistant Document, Matter Intelligence, client shared Work Product, client portal Work Product, Matter Source, and Firm Library previews pass their actual titles.
- Lawyer Assistant, Client Assistant, general response, citation-aware message, and Assistant response-editor previews intentionally remain on `FormattedMarkdown`.

Schema and persistence:

- No database or migration changes were made. No stored document was rewritten. Markdown remains the persisted format.
- All five DOCX routes remain on `markdownToDocxDocument`; no export API, cleanup, ownership, filename, model, prompt, retrieval, or Gemini behavior changed.

Checkpoint A verification:

- `npm ci`: passed through the Windows `npm.cmd` shim.
- `npm run lint`: passed (`tsc --noEmit`).
- `npm test`: passed, 268/268 tests.
- `npm run build`: passed outside the managed filesystem sandbox; the identical sandboxed attempt was blocked from reading the Vite config's parent path. The pre-existing large-chunk warning remains.
- `npm run verify`: passed outside the managed filesystem sandbox; lint, 268/268 tests, and production Vite/esbuild build completed.
- Automated server-rendered preview coverage verifies titles, headings, inline marks, hard breaks, link safety, list starts/nesting, table semantics/widths/alignment, signature layout, landscape layout, malformed fallback, and code newlines. Existing DOCX compiler/XML tests passed unchanged in behavior.

Manual browser checks:

- Not completed at Checkpoint A. This environment has no authenticated interactive browser session, so visual clipping, overlap, and responsive scrolling checks remain pending.

Checkpoint B — structured editor:

- Replaced the handwritten `contentEditable`/`execCommand` editor with Tiptap 3.29.2 using `useEditor`, `EditorContent`, StarterKit, safe links, underline, and table extensions. Formal editor call sites now pass the same real title used by their preview.
- Added the Exepts-owned, DOM-free `documentEditorCodec`. The opening path is Markdown → `compileDocument` → `CompiledDocument` → deterministic Tiptap JSON. On updates the path is Tiptap JSON → deterministic GFM serializer → `compileDocument(title, markdown)` → normalized Markdown → existing `onChange` and save APIs.
- The editor supports H1–H6, paragraphs, bold, italic, underline, inline code, safe HTTP/HTTPS/mailto links, hard breaks, ordered lists with authored starts, unordered lists, bounded mixed nesting, blockquotes, fenced code with language metadata, and GFM tables.
- The serializer owns stable blank lines, inline escaping, mark order, safe link degradation, variable-length inline-code and block-code delimiters, list indentation, table separator/alignment rows, literal-pipe escaping, `<br>` cell breaks, missing-cell padding, and deterministic empty-document output. It emits no raw HTML except `<u>` and `<br>`.
- Table cells and headers are restricted to one paragraph with supported inline content. Multiline or multi-block cell paste is conservatively flattened with hard breaks; file drops are rejected; embedded media, scripts, styles, iframes, objects, and arbitrary raw HTML are not part of the schema.
- Merged cells, row spans, column spans, nested tables, lists/quotes/code blocks inside cells, and multiple independent cell paragraphs are deliberately excluded because GFM cannot persist them losslessly. Manual column resizing is also excluded because widths cannot be preserved through canonical Markdown.
- Added compact controls for paragraph/H1–H6, quote, code block, bold, italic, underline, inline code, lists, link/unlink, table insertion, undo, and redo. Contextual table controls add/delete rows and columns, toggle the header row, align the complete selected column left/centre/right, and delete the table. No merge/split controls exist.
- Initial canonical table layout, orientation, signature classification, column kind, alignment, and width weights are carried as editor-only attributes for presentation. They are recalculated by the canonical compiler after changes and are never persisted as JSON or HTML.
- Controlled synchronization tracks the last Markdown emitted by the editor. Parent echoes do not call `setContent`, reset selection, or wipe undo history. Only genuine external values are converted and applied with update emission disabled; selection is restored when its positions remain valid.
- Removed `src/lib/richMarkdown.ts`, all `document.execCommand`, direct `innerHTML`, layout-effect HTML replacement, and formal-document `FormattedMarkdown` use. Removed the unused `@uiw/react-md-editor` dependency.
- Chat messages, citation-aware responses, general conversational output, and the Assistant response editor intentionally remain outside the formal-document pipeline and continue using `FormattedMarkdown` where they did before.

Dependencies:

- Added `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-table`, `@tiptap/extension-link`, and `@tiptap/extension-underline`, all at the mutually compatible 3.29.2 release.
- Removed `@uiw/react-md-editor`. No Tiptap Markdown, Pro, Cloud, collaboration, or AI editor package was added.

Round-trip and regression coverage:

- All 16 Phase 1 Markdown fixtures pass Markdown → compiler → editor JSON → Exepts serializer → compiler semantic comparison, covering block types, marks, links, breaks, list types/starts/levels, code/language, table cells/alignment/classification/layout/orientation, signatures, repaired tables, and readable fallbacks.
- Focused tests cover unsafe-link degradation, deterministic serialization, embedded backticks, escaped pipes, table hard breaks, empty cells, row/column shape changes, complete-column alignment, unsupported cell-block flattening, allowed raw HTML, empty documents, and controlled-value synchronization decisions.
- Source regressions require titles at formal preview/editor call sites, canonical compiler/codec use, table extensions and controls, continued chat `FormattedMarkdown`, five shared DOCX façade calls, unchanged migrations, and the absence of legacy browser/converter mechanisms.

Schema and persistence:

- No database schema or migration changes were made, and no historical document was rewritten. Normalized Markdown remains canonical persistence through the existing API payloads and columns; Tiptap JSON and browser attributes are never saved.
- Existing Work Product, Assistant Document, client revision, sharing, ownership, cleanup, Matter Intelligence snapshot, export route, and filename behavior remains unchanged. All five DOCX routes remain on `markdownToDocxDocument`.

Checkpoint B verification:

- `npm ci`: passed through `npm.cmd`.
- `npm run lint`: passed (`tsc --noEmit`).
- `npm test`: passed, 280/280 tests.
- `npm run build`: passed outside the managed filesystem sandbox; the existing large-chunk warning remains and the editor increases the main bundle size.
- `npm run docx:fixtures`: passed and regenerated all 16 review fixtures through the shared façade under `tmp/docx-review/`.
- `npm run verify`: passed outside the managed filesystem sandbox; lint, 280/280 tests, and production Vite/esbuild build completed.
- `npm ls --depth=0`: passed and shows all six Tiptap packages at 3.29.2.

Manual browser acceptance and remaining limitations:

- No authenticated interactive browser was available, so the requested live preview inspection and edit/save/reload/export workflows were not performed and are not claimed as passed. Cursor behavior, undo continuity, paste/drop behavior, contextual table controls, responsive scrolling, visual clipping/overlap, and persistence across every formal surface still require interactive acceptance.
- Browser preview uses explicit orientation/page-break paper sections and minimum physical page dimensions; it intentionally does not fake automatic pagination or browser page numbers.
- GFM restrictions intentionally exclude merged cells, arbitrary multi-block cell content, media, manual column-width persistence, tracked changes, comments, collaborative editing, import, and a pagination engine.
- npm reported one moderate vulnerability during the dependency update; no broad `npm audit fix` was run because it could change unrelated dependency versions.

## Unified Autonomous Lawyer Assistant

### Checkpoint 1 — Conversation continuity and deterministic references

Status: Implementation complete; checkpoint verification recorded below.

- Reordered the lawyer Assistant message lifecycle so the authenticated thread and submitted page entity are authorized first, owned prior messages are loaded, the user message is persisted, first-message title generation is started, recent conversation and rolling memory are assembled, and only then is the planner called with deterministic conversation state.
- Added a framework-neutral conversation-state builder with exact recent turns, page labels, attachment names, a generated-artifact ledger, conversation research-source references, the latest created artifact, and rolling memory. Limits are 20 turns, 12 artifacts, 10 research-source references, and 16,000 recent-turn characters for planning.
- The artifact ledger derives only from owned `message.metadata.document` values, preserves exact IDs and Matter IDs, deduplicates by exact artifact ID while keeping the newest reference, and never treats titles as authorization.
- Assistant prompt/history formatting now includes safe document kind, title, exact artifact ID, Matter ownership where applicable, page labels, and attachment names without loading full generated-document content or arbitrary metadata.
- Rolling-memory input now receives those safe document and attachment references while retaining the existing refresh thresholds, 6,000-character summary ceiling, lightweight model, secret filtering, and failure fallback. Memory remains continuity context rather than authoritative artifact identity.
- Extracted Research source text is sanitized and stored under owned user-message metadata without schema changes: at most five sources, 30,000 characters per source, and 75,000 characters per message. Binary bytes, cloud credentials, provider URLs, and tokens are not stored by this path.
- Added a public Assistant-message mapper used by lawyer message GET and POST responses. It preserves attachment names, document cards, citations, suggestions, steps, and other safe metadata while removing every stored `researchSources[].text` value before browser delivery.
- Historical name-only attachments remain visible but are deterministically marked unavailable; later turns can reuse only source text that actually exists in owned server metadata.
- Added deterministic artifact and research-source resolvers. Current authorized page documents take precedence, exact named/validated ledger references are honored, clear “document you just created” references use the newest ledger entry, and ambiguous direct revision pronouns request clarification.
- Explicitly retrieved historical conversations now include safe document references and attachment names rather than plain message text alone.
- Added focused conversation-state, artifact-continuity, and research-source-continuity tests. No database migration was added. Client Assistant, model assignments, thinking defaults, DOCX routes, canonical preview, Tiptap editor, and Markdown persistence were not changed.

Checkpoint 1 verification:

- `npm run lint`: passed (`tsc --noEmit`).
- `npm test`: passed, 292/292 tests.
- `npm run build`: passed outside the managed filesystem sandbox; the existing large-chunk warning remains.
- `npm run verify`: passed outside the managed filesystem sandbox; lint, all 292 tests, and the production Vite/esbuild build completed successfully.

### Checkpoint 2 — Autonomous scoped retrieval and private-safe web research

Status: Implementation complete; checkpoint verification recorded below.

- Replaced mode/toggle planner inputs with autonomous intent, depth, current-page, workspace, public-web, clarification, and deliverable decisions. The strict plan schema now contains `deliverable`, `referencedArtifactIds`, and `referencedResearchSourceIds`; unknown keys, tools, arguments, Matter IDs, artifact IDs, and research-source IDs invalidate model output.
- Deliverables are explicitly planned as `message`, `document`, or `message_and_document`, with `create` or `revise` actions where applicable. Revisions require an exact authorized source artifact; ordinary explanations and short clause fragments remain messages.
- Removed the ambiguous `search_workspace_documents` tool. Matter Sources now use `get_matter_source` and `search_matter_documents`; Firm Library uses `get_firm_library_document` and `search_firm_library_documents`. A current Matter never redirects an explicit Firm Library request.
- Exact Matter Source reads authorize the Matter first and call the existing Firm-scoped `getDocumentById(documentId, ownership, matterId)` boundary. Exact Work Product, Firm Library, Assistant Document, Matter Intelligence, Overview, and Collaboration page references map to their dedicated read-only tools.
- Added a bounded retrieval orchestrator. It injects exact current-page, artifact-ledger, and conversation-source references; deduplicates calls; executes at most eight calls; optionally plans one final retrieval round; and carries resolved Matter authorization into round two. At most two separately resolved non-current Matters remain allowed through the executor.
- Current-thread references are supplied directly and global History search is filtered unless the request explicitly identifies another conversation, past conversations, a named thread, or cross-thread History.
- Conversation research-source IDs resolve to sanitized extracted text from owned message metadata and enter the same bounded evidence packet without asking the model to reconstruct storage identities.
- Added a private-safe public research boundary: a non-search lightweight-model call proposes at most three public questions from a deterministically redacted task; a second call receives only sanitized questions, public jurisdiction, and current UTC date with Google Search enabled; final synthesis and draft generation always use `googleSearch: false`.
- Deterministic redaction covers authenticated user and client names/emails, Firm and Matter names/IDs, resolved Matter IDs, generated-document IDs/titles, attachment filenames, selected/private document titles, Exepts IDs, emails, bearer/query-string tokens, secret-looking values, and explicitly identified confidential parties. If no safe useful question remains, public search is skipped.
- Google grounding chunks are converted into ordinary Exepts web citations and their inline references are rewritten before the grounded report reaches private synthesis. No grounding chunks means `performed: false`, no web citations, and no claim that a search occurred.
- Existing citation canonicalization, authorization boundaries, model assignments, thinking defaults, Client Assistant, DOCX routes, preview/editor behavior, and Markdown persistence remain unchanged. No database migration was added.

Checkpoint 2 verification:

- `npm run lint`: passed (`tsc --noEmit`).
- `npm test`: passed, 307/307 tests.
- `npm run build`: passed outside the managed filesystem sandbox; the existing large-chunk warning remains.
- `npm run verify`: passed outside the managed filesystem sandbox; lint, all 307 tests, and the production Vite/esbuild build completed successfully.

### Checkpoint 3 â€” Autonomous Assistant documents and safe revisions

Status: Implementation complete; checkpoint verification recorded below.

- Removed `legacyRequestMode` and the lawyer message endpoint's Draft, workspace, general/UI, direct-vector, and deep-vector response branches. The authenticated route now delegates bounded retrieval to the orchestrator and all response/document outcomes to one completion path driven only by `assistantPlan.deliverable`.
- Added a deliverable service that reuses the canonical export-safe drafting prompt, generated-work-product cleanup, title derivation, `draft-generation` model assignment, Markdown persistence, and existing Matter Work Product or private Assistant Document creation paths. Draft generation never enables Google Search directly; already-grounded public research is supplied as bounded evidence.
- New documents created from an authorized Matter page are saved to that current Matter. Documents created outside a Matter remain user-owned and Firm-scoped Assistant Documents; a Matter found during research never becomes an implicit write destination.
- Autonomous revisions fetch the exact deterministic artifact. Matter Work Product revisions are inserted as new records in the same authorized Matter with `parent_draft_id` set to the source ID, `revision_type = 'Duplicate'`, and `origin = 'Assistant revision'`. Assistant Document revisions create a separate private Assistant Document. Neither path updates or deletes the original.
- Revision responses retain both `metadata.document` for the new card and `metadata.sourceDocument` for the exact original. Unknown source IDs are rejected, current selected documents retain deterministic precedence, and direct memo/letter/agreement/report revision language resolves through the artifact ledger rather than a workspace list search.
- Implemented all three deliverable outcomes: `message` produces one normal answer; `document` produces a concise creation/revision confirmation with one document card; `message_and_document` creates the document and synthesizes one concise explanation covering the main conclusion, important assumptions or missing facts, and document contents from the same authorized evidence.
- Unified metadata now records suggestions, Assistant intent, deliverable kind, actual workspace use, actual public-web use, the generated document, and source document where applicable. New lawyer Assistant messages no longer write `requestMode`; historical metadata remains readable.
- Thorough requests retain bounded `ResearchStep[]` presentation built only from locations actually checked, actual public research, and an actual second retrieval round. Ordinary requests store `null` steps, and no hidden reasoning is exposed.
- Follow-up suggestion generation receives only safe document title, kind, create/revise action, recent conversation, and the assistant response. Full private document content is not added solely for suggestions.
- Added focused autonomous-deliverable, exact-follow-up, and safe-revision tests and updated stale mode-branch regressions to inspect the unified orchestrator/completion architecture. No schema migration was added. Client Assistant, model IDs/default thinking, all five DOCX routes, canonical preview, Tiptap editor, and Markdown persistence remain unchanged.

Checkpoint 3 verification:

- `npm run lint`: passed (`tsc --noEmit`).
- `npm test`: passed, 317/317 tests.
- `npm run build`: passed outside the managed filesystem sandbox; the existing large-chunk warning remains.
- `npm run verify`: passed outside the managed filesystem sandbox; lint, all 317 tests, and the production Vite/esbuild build completed successfully.

### Checkpoint 4 â€” Unified Send composer and obsolete-mode removal

Status: Implementation complete; checkpoint verification recorded below.

- Simplified the lawyer `AssistantView` to one autonomous composer. Its bottom control row contains Research sources on the left and one Send button on the right, with only Send and Sendingâ€¦ states. Matter and non-Matter placeholders remain context-aware without exposing a Draft mode.
- Research sources continues to open the existing Device, Google Drive, and Dropbox file picker. Selected/extracting/error files remain visible as removable chips, ready extracted files are submitted, and the selection clears after a successful response. The dropdown explains that attached files remain available to the conversation.
- Removed the Draft toggle, Draft state, Draft-specific placeholder and progress copy, Create Draft/Ask submit labels, Web Search chip, Google Grounding control, quick-enable suggestion, and all related resets and visual branches. Autonomous web citations remain visible after a response through the unchanged citation renderer and panel.
- The browser message payload now contains only `content`, sanitized `pageContext`, and ready `temporaryFiles`. It no longer sends `responseMode`, `enableWebSearch`, or `forceDeepResearch`; the server ignores obsolete fields because planning reads none of them.
- Deleted the browser-side `assistantRequestRouting` classifier and its production export. The client no longer predicts general, workspace, deep-research, or document outcomes; the server planner and bounded orchestrator own every decision.
- Replaced mode-aware working activities with one neutral progressive sequence: understanding the request, checking the conversation/current context, optionally reviewing attached research sources, working with relevant information, and preparing the response. It does not claim document creation or web research before server results exist.
- Updated the empty-state language to describe questions, workspace work, document creation, and research sources as capabilities of one Assistant. Ordinary answers no longer display the misleading `0 sources matched` footer; the source control appears only when citations exist.
- Preserved simulated response reveal, citation hover/panel, copying, feedback, rewrite shortcut, follow-up pills, thorough-research steps, document cards and navigation, DOCX download controls, the side response editor, compact layout, panel width behavior, and chat `FormattedMarkdown`.
- Added focused unified-composer and autonomous-orchestrator coverage, renamed the obsolete Draft-mode regression file, and updated neutral-activity and prior UI regressions. Client Assistant files were not changed. No schema migration was added, and formal preview/editor/DOCX behavior remains on the existing pipeline.

Checkpoint 4 verification:

- `npm run lint`: passed (`tsc --noEmit`).
- `npm test`: passed, 323/323 tests.
- `npm run build`: passed outside the managed filesystem sandbox; the existing large-chunk warning remains.
- `npm run verify`: passed outside the managed filesystem sandbox; lint, all 323 tests, and the production Vite/esbuild build completed successfully.

Final verification and acceptance coverage:

- The final committed implementation passed `npm run lint`, `npm test` (323/323), `npm run build`, and `npm run verify`. The established large JavaScript chunk warning remains non-fatal.
- `npm run docx:fixtures` passed and regenerated all 16 review documents through the unchanged shared DOCX faÃ§ade under the gitignored `tmp/docx-review/` directory.
- Production source searches found no `draftMode`, `enableWebSearch`, `responseMode`, `forceDeepResearch`, `routeAssistantRequest`, `legacyRequestMode`, `search_workspace_documents`, pre-request Google Grounding UI, Create Draft control, Ask submit control, misleading zero-source footer, or direct-vector branch in the lawyer message endpoint.
- Automated scenarios cover exact generated-document follow-ups, non-overwriting Work Product and Assistant Document revisions, selected Matter/Library/Assistant documents, separate Matter and Firm Library retrieval, conversation-bound research sources and API stripping, autonomous private-safe public research, message/document combined outcomes, general tool-free conversation, and explicit cross-thread History behavior.
- No authenticated interactive browser or live production Gemini/database session was available, so end-to-end visual clicks, real cloud-picker authorization, live grounded queries, persisted database reloads, and opening/exporting both sides of a live autonomous revision were not manually executed and are not claimed as passed. Their deterministic service, route, UI, authorization, compiler, editor, and export paths are covered by the passing automated suite.
- No database migration was added. Client Assistant was unchanged. Existing model assignments, thinking defaults, five DOCX routes, canonical preview, Tiptap editor, Markdown persistence, authentication, and workspace/Matter/client isolation remain covered by regression tests.

### User-perspective Assistant follow-up wording

- Suggested follow-ups are now prompted and deterministically normalized as user-authored, context-specific messages that are ready to send verbatim when clicked. Assistant-offer prefixes are converted to direct instructions, normalized duplicates are removed case-insensitively, and existing direct questions and instructions remain unchanged.

### Semantic Assistant Document Intent

Status: Implementation complete; focused-phase verification recorded below.

- Added a deterministic, framework-independent document-intent detector and plan reconciler with six bounded outcomes: explicit message-only, explicit creation, explicit revision, accepted document offer, informational message, and no high-confidence override.
- Formal-deliverable creation is now meaning-based rather than dependent on `generate`. It recognizes direct drafting language, emails and email messages, conversion instructions such as turn/convert/return/provide/put/format/save as, and the supported reusable document types.
- Short affirmative replies accept only the latest preceding Assistant turn when that turn clearly offers to create a supported formal deliverable. Explanation, search, review-only, opening, and workspace-edit offers do not trigger document creation.
- Explicit chat-only and non-persistence language has highest precedence and always removes document creation or revision fields from the deliverable plan.
- Conversation-content conversions create new documents. Revisions require wording that identifies an existing saved artifact, continue through the authorized artifact resolver, use an exact artifact ID when deterministic, and ask one focused clarification when missing or ambiguous.
- Both valid model plans and deterministic fallback plans now pass through the same high-confidence reconciliation layer. Corrected plans preserve depth, retrieval, current-page, web, tool-call, research-source, and relevant artifact decisions.
- Added `tests/assistant-document-intent.test.ts` covering direct creation, combined message/document requests, informational and short-wording messages, chat-only overrides, exact and ambiguous revisions, accepted offers, and valid-model-plan correction.
- Verification passed: `npm run lint`; `npm test` (345/345); production build; DOCX fixture generation; and `npm run verify` (lint, 345/345 tests, and production build). The existing non-fatal large-chunk warning remains.
- No database schema or migration, dependency, retrieval architecture, web-research boundary, authorization rule, document destination/storage/rendering, DOCX, preview, editor, composer, Client Assistant, or other UI behavior changed.

### Lawyer Assistant Citation and Resilience Cleanup

Status: Implementation complete; focused-phase verification recorded below.

- Removed visible inline citation markers from newly saved Lawyer Assistant responses and from historical responses at render time. Response copying now uses the same deterministic citation-free text and does not append a source list.
- Preserved complete citation arrays, workspace and web metadata, Google grounding conversion, source titles/names/snippets/URLs, and the singular/plural Sources Referenced footer and source panel.
- Updated the final-response prompt to use authorized evidence accurately without exposing internal citation identifiers, source numbers, footnotes, source links, or an appended source list. Workspace facts, general knowledge, legal inference, current public research, and missing information remain distinct.
- Added structured Gemini error classification for temporary capacity and network failures, authentication/configuration failures, invalid requests, content blocks, and unknown failures across common SDK error shapes.
- Added a four-attempt shared model-call retry boundary (one initial attempt and three retries) with 1.5s, 3.5s, and 7s base delays, up to 500ms jitter, and clamped 1sâ€“15s `Retry-After` support. Retry logs contain task/model, retry, delay, classification, and status only.
- Added calm final capacity, network, authentication/configuration, and unknown error messages. Removed the browser's unconditional API-key advice and error-symbol prefix; client-only failures are flagged locally so feedback/copy controls stay hidden.
- Added focused inline-citation, transient-retry, and friendly-error tests and updated related Lawyer/Client Assistant source regressions.
- No retrieval, planning, semantic document intent, document creation/revision/export/preview/editor, database, migration, dependency, composer, model assignment/thinking level, or Client Assistant behavior changed.
- Verification passed: `npm run lint`; `npm test` (362/362); production build; all 16 DOCX review fixtures; and `npm run verify` (lint, 362/362 tests, and production build). The existing non-fatal large-chunk warning remains.

### DOCX export and Assistant control hotfix

Status: Implementation complete; focused verification recorded below.

- Normalized the ESM-only `remark-parse` and `remark-gfm` default exports at the shared parser boundary so both direct ESM execution and the externalized CommonJS production server bundle pass plugin functions to Unified.
- Replaced only the formal editor and Assistant document-card tab-opening exports with a shared same-origin fetch/blob download helper. It checks HTTP success, honors a safe `Content-Disposition` filename with a `.docx` fallback, and revokes its temporary object URL.
- Kept the main Lawyer Assistant submit button visually fixed as Send with the normal Send icon while preserving its existing loading-based disabled guard and request processing.
- Focused DOCX/UI tests passed (45/45), `npm run lint` passed, and `npm run build` passed outside the managed filesystem sandbox with the existing non-fatal large-chunk warning. A production-format CommonJS check generated a valid 12,832-byte DOCX ZIP containing `word/document.xml`.
- No dependency, schema, migration, route, authentication, ownership, document content, formatting, API, or architecture change was made.

### Matter user access control security fix

- Fixed confirmed intra-Firm Matter visibility: Firm membership alone no longer authorizes lawyer access to every Matter.
- Added additive migration 25, `matter_user_access_control`, with per-user Matter grants and a `(user_id, case_id)` listing index. The migration backfills all existing lawyer/Matter relationships by matching `firm_id`, preserving access for users present when it runs.
- Invitation-code onboarding does not create Matter grants, so lawyers joining after migration receive no pre-existing Matter access. New Matter creation atomically grants access only to its creator.
- Centralized lawyer-side Matter authorization returns `Matter not found` for missing, cross-Firm, and unassigned Matter IDs. Matter lists and direct reads filter by both authenticated user and Firm; Matter Sources, Intelligence, Collaboration, conversations, Work Product, and assistant paths inherit the same database boundary.
- No Matter assignment UI or other feature was added. Firm Library sharing and Client Portal authorization remain unchanged.

### Controlled Testing Access Gate

Status: Implementation complete; focused-phase verification recorded below.

- Added additive migration 26, `controlled_testing_access_gate`. Version 26 was used because version 25 already existed for Matter user access control. The migration adds non-null `users.platform_access_status` with the safe `pending` default and an approved/pending/denied check constraint, plus nullable `access_submitted_at` and `access_reviewed_at` timestamps.
- The migration backfills every existing lawyer to `pending`. Existing clients with a currently active claimed collaboration are marked `approved` for account consistency, but Client Workspace authorization remains derived exclusively from an active, unrevoked `matter_client_access` claim with a non-null token hash. Existing collaboration claims are not removed or changed.
- Added `access_review_requests` with a cascading user reference, unique SHA-256 token hash, creation/expiry/consumption/invalidation timestamps, constrained nullable decision, and notification success/failure timestamps. Indexed user/recent request lookup, token lookup, expiry, and pending-user lookup.
- Review tokens use 32 cryptographically secure random bytes encoded as base64url, are strictly parsed, expire after seven days, and are stored only as SHA-256 hashes. Issuance locks the applicant, enforces a five-minute cooldown and five-request rolling daily limit, and invalidates prior unconsumed requests transactionally.
- Lawyer onboarding retains its existing validation and workspace transaction, sets pending access and the submission timestamp once, then returns `/access`. Administrator email issuance occurs only after onboarding commits; a Brevo/configuration failure does not roll onboarding back.
- Added public, no-store `GET /api/access-reviews/:token` and `POST /api/access-reviews/:token/decision`. GET is read-only. Decision POST locks both the request and lawyer, rejects expired/invalidated requests, consumes the request transactionally, prevents an opposite overwrite, and sends the applicant email only after commit. Same-decision retries do not resend email.
- Added authenticated `POST /api/access/request-review` for completed pending lawyers. It returns `429` with `Retry-After` for cooldown/daily limits and a stable configuration error when review administrators are unavailable.
- Added the central approved-lawyer middleware after authentication, account-type, and onboarding checks. Pending and denied lawyers receive stable `ACCESS_REVIEW_PENDING` or `ACCESS_REVIEW_DENIED` codes. `ownership()` and Firm Admin authorization also require approval, and firm administration/Assistant member summaries omit non-approved lawyers without removing their Firm association.
- Added a central `CLIENT_COLLABORATION_REQUIRED` gate for Client Workspace product routes after keeping collaboration redemption, Shared Matter listing, authentication status, and logout available. A successful collaboration claim updates the client status in the same transaction, while the central decision still depends on the live derived claim.
- Added `/access` and public `/access-review/:token` route handling plus focused lawyer access, administrator review, and client collaboration-token screens. The public review screen renders before the unauthenticated site-lock branch and never decides on load. Restricted accounts never render either workspace navigation shell.
- Added `ACCESS_REVIEW_ADMIN_EMAILS` to `.env.example`. It accepts a validated comma-separated administrator list and reuses `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, and `APP_URL`. User-controlled HTML email fields are escaped; raw review tokens appear only in the intended administrator review URL and are never stored or logged.
- Added focused migration, token security, idempotency, middleware ordering, Brevo failure-boundary, client gate, site-lock, and frontend routing tests. Updated only existing tests directly affected by the new account shape, middleware boundary, and onboarding destination.
- Verification passed: `npm run lint`; `npm test` (380/380); and `npm run build`. The build required execution outside the managed filesystem sandbox after its initial Vite config resolution was denied. The existing non-fatal large-chunk warning remains.
- Deployment action: configure `ACCESS_REVIEW_ADMIN_EMAILS` with valid Exepts reviewer addresses, verify the existing Brevo sender and `APP_URL` settings, and deploy/restart so migration 26 runs normally. No data was deleted or reset. Any desired full testing-data reset remains a separate, deliberate external deployment operation.

### Universal Lawyer Assistant response documents

Status: Implementation complete; focused verification recorded below.

- Added lightweight Open and Download actions to every successful Lawyer Assistant response while preserving the existing Copy, latest-response-only Rewrite, feedback, citation, suggestion, streaming, and generated-document card behavior.
- Existing Assistant Document and Matter Work Product references are reused directly. Ordinary text responses lazily get one deterministic private Assistant document through the existing editor, save, and DOCX export infrastructure.
- Added an authenticated get-or-create message endpoint and an idempotent, workspace/Matter-scoped database method using `INSERT ... ON CONFLICT DO NOTHING`. Existing saved edits are never overwritten on repeated Open or Download requests.
- Focused test passed (9/9), `npm run lint` passed, and `npm run build` passed outside the managed filesystem sandbox after the initial Vite config read was denied. The existing non-fatal large-chunk warning remains.
- No schema migration, dependency, model call, prompt, retrieval, citation, conversation, Client Assistant, generated-document, editor, DOCX implementation, or routing architecture change was made.

### Context-appropriate attachment completeness

Status: Implementation complete; focused-phase verification recorded below.

- Added one Lawyer Assistant drafting rule requiring exhibits, schedules, annexes, and appendices only when the document type, instruction, drafting convention, context, or internal cross-references call for them.
- The rule directs the Assistant to complete appropriate attachment references in conventional order without inventing Matter facts or evidentiary material; unavailable required facts must be marked for lawyer completion.
- Attachments are explicitly not automatic and must not be added where inappropriate or unhelpful.
- Added one focused prompt-level regression test. No DOCX, parser, editor, persistence, database, UI, dependency, model setting, or Assistant architecture changed.
- Verification passed: focused autonomous-document test (10/10), `npm run lint`, and `npm run build`. The build required execution outside the managed filesystem sandbox after its initial Vite config read was denied; the existing non-fatal large-chunk warning remains.

### Landing access label and first-share Collaboration introduction

Status: Implementation complete; focused verification recorded below.

- Changed all three landing-page `Request a Demo` labels to `Request Access` without changing their existing handlers or the `/request-demo` flow.
- After the first successful client-share operation in each Matter, the Work Product view records a Matter-specific browser marker and opens the existing Collaboration tab. Later shares in that Matter stay in Work Product; failed shares and Stop sharing do not set the marker or navigate.
- No route, API, backend sharing behavior, schema, migration, dependency, styling, authentication, or Collaboration flow changed.
- Verification passed: focused Work Product presentation tests (9/9), `npm run lint`, and `npm run build`. The build required execution outside the managed filesystem sandbox after its initial Vite config read was denied; the existing non-fatal large-chunk warning remains.

### Best-effort collaboration email notifications

Status: Implementation complete; focused verification recorded below.

- Added short Brevo notifications after successful document sharing, collaboration request creation, active Client Revision creation, and active client request responses.
- Client notifications use only the Matter's active, non-revoked collaborator with a valid email. Lawyer notifications use distinct approved lawyer users with explicit `matter_user_access` for the Matter and valid emails.
- Recipient lookup and delivery are detached and caught, so missing recipients or email failures do not change successful collaboration API results. Emails omit document contents, request instructions, response text, filenames, and revision contents.
- Added no schema migration, dependency, frontend change, legacy-route hook, or response-payload change.
- Verification passed: focused collaboration tests (47/47), `npm run lint`, the full test suite (388/388), and `npm run build`. The build required execution outside the managed filesystem sandbox after its initial Vite config read was denied; the existing non-fatal large-chunk warning remains.

### Assistant Voice Mode standardization

Status: Implementation complete; focused-phase verification recorded below.

- Renamed the Assistant composer control from `Research sources` to `Sources`, retained the existing attachment/source behavior, and changed Send to an accessible icon-only control with `aria-label` and title text.
- Added a persistent Exepts-native Voice Mode toggle with explicit off, connecting, listening, speaking, and error states. The control uses restrained state motion plus real microphone or assistant playback amplitude, and retains a clear static active treatment under reduced-motion preferences.
- Added a dedicated browser Gemini Live lifecycle separate from the standard `handleSend` pipeline. It streams downsampled 16 kHz PCM microphone chunks, schedules native PCM response chunks immediately, uses server VAD, clears queued playback on interruption/barge-in, and releases microphone tracks, Web Audio nodes/context, animation frames, playback sources, and the Live socket on stop, thread change, new conversation, failure, or unmount.
- Centralized the Live configuration in `server/voiceMode.ts`: `gemini-3.1-flash-live-preview`, Gemini API `v1beta`, the professional `Kore` native voice, minimal thinking, native audio output, input/output transcription, initial-history mode, and sensitive automatic activity detection. The voice prompt explicitly preserves the fast conversational boundary and does not claim deep research, retrieval, document generation, or tool execution.
- Added an authenticated, no-store, thread-owned token endpoint. The backend provisions a one-use Gemini ephemeral credential with a one-minute new-session window and 30-minute session expiry, locks it to the model and Voice configuration, and never returns the permanent Gemini API key.
- Seeds each Live session with at most 12 recent owned-thread messages and 6,000 characters through Gemini's initial-history mechanism. Voice Mode performs no Matter or workspace retrieval; only the already authorized current thread history is supplied.
- Added a narrow authenticated transcript endpoint and an idempotent database insert using deterministic server-derived message IDs. Only finalized Gemini input/output transcripts are queued asynchronously, stored as ordinary user/assistant messages with `interactionMode: "voice"`, ordered user-before-assistant, and inserted promptly into the current conversation. Interim/revised events do not create duplicate messages, and persistence failure is reported without terminating live audio.
- Because voice transcripts use the existing messages table and normal thread ownership boundary, text-to-voice continuity comes from bounded Live history and voice-to-text continuity comes through the existing standard Assistant history without a parallel synchronization system.
- Added focused coverage for the composer contract, centralized Live configuration, history bounds, PCM/transcription helpers, resource cleanup, interruption, deterministic deduplication, workspace/thread authorization, credential security, transcript roles, and separation from normal Assistant generation. Updated only directly affected composer and newline-sensitive server-order assertions.
- No database migration, dependency change, permanent browser credential, browser speech synthesis pipeline, parallel history store, Client Assistant change, or standard Assistant model/prompt/generation change was made.
- Verification passed: `npm run lint`; focused tests (29/29 and affected-regression tests 37/37); full suite (395/395); and `npm run build`. The build required execution outside the managed filesystem sandbox after Vite config resolution was denied; the existing non-fatal large-chunk warning remains.
- Preview considerations: Gemini Live ephemeral credentials and `gemini-3.1-flash-live-preview` remain Preview APIs. A live authenticated microphone/Gemini session was not available in this environment, so real provider audio quality, browser permission UX, and the provider's 30-minute token/session expiry behavior are not claimed as manually exercised.

### Voice Mode empty-history corrective patch

- Fixed fresh-conversation Live initialization so an empty or malformed history value completes the initial-history phase with `{ turnComplete: true }` and never sends the SDK-invalid `turns: []` payload.
- Preserved the populated-conversation path exactly: existing turns are still sent with `turnComplete: true`.
- Added behavioral mock-session coverage for empty, missing, malformed, and populated history without contacting Gemini. No audio, animation, transcript, model, authentication, standard Assistant, dependency, or schema behavior changed.
- Verification passed: focused Voice Mode tests (9/9), `npm run lint`, full test suite (397/397), and `npm run build`; the existing non-fatal large-chunk warning remains.

### Voice Mode stabilization and authorized current context

- Removed microphone amplitude as a playback-interruption authority while preserving microphone/assistant visualization. Gemini Live `content.interrupted` remains the immediate playback stop signal, and automatic VAD now uses LOW start sensitivity with its existing end sensitivity and timing unchanged.
- Voice startup now posts page context for server sanitization and ownership validation. The validated Matter is bound to the thread's stored Matter, selected Sources and Work Products are confined to that Matter, Firm Library and Assistant documents retain their existing context/ownership rules, and a bounded authorized current-page context seeds the Live session.
- Added one authenticated read-only `lookup_workspace` Live function and endpoint. Its deterministic server-side plan accepts only a query, derives all entity and Matter scope from revalidated current context, reuses bounded Assistant evidence helpers, performs no web research or write action, and does not alter the standard Assistant generation route.
- Live input/output transcription now appears progressively as temporary user/assistant messages in the existing conversation stream, including empty threads. Final turns still use the existing idempotent `/voice/messages` persistence route; saved messages replace matching temporary bubbles without invoking standard Assistant generation.
- No schema migration, dependency, model, voice, native-audio, ephemeral-credential, permanent-key, standard Assistant, or persistence architecture change was made.
- Verification: focused Voice Mode tests passed (11/11), `npm run lint` passed, the full test suite passed (399/399), and the production build passed after the managed filesystem sandbox initially blocked Vite config resolution. The existing non-fatal large-chunk warning remains.
