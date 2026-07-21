# Compact Upgrade Progress

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
