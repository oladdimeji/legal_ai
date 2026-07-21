# Compact Product Upgrade Execution Plan

Date: 2026-07-21  
Branch: `upgrade/compact-v1`  
Scope: Phases 3–10 only. The verified authentication, ownership, and retrieval foundation remains authoritative.

## Cross-phase guardrails

- Retain React, Express, PostgreSQL/pgvector, Gemini, existing `/api/cases` compatibility, and internal `cases`/`case_id` names.
- Add only numbered, transactional, repeatable, non-destructive migrations.
- Resolve every internal request through the authenticated User/Firm context; resolve every portal request through a valid, unrevoked, Matter-specific token hash.
- Preserve all existing records, including temporary validation fixtures, two ambiguous draft-like documents, and six redundant legacy Case-document links.
- Keep General retrieval limited to Firm Library rows and Matter retrieval limited to direct or explicitly linked Sources before vector ordering/limiting.
- Preserve the monochrome interface, global sidebar, Assistant, existing draft editor, and DOCX export.
- After each phase: add focused tests, run `npm test`, `npm run lint`, and `npm run build`, perform the listed verification, update `docs/UPGRADE_PROGRESS.md`, and create one phase commit.

## Phase 3 — Navigation and Firm Library Separation

### Checklist

- [x] Modify `src/App.tsx` to route distinct `matters`, `library`, and `settings` views while retaining temporary `drafts` routing.
- [x] Modify `src/components/Sidebar.tsx` to show Assistant, Matters, Firm Library, Drafts (temporary), History, and Settings with existing collapse/account behavior.
- [x] Create `src/components/FirmLibraryView.tsx` by extracting the workspace-level document search, semantic search, sections, preview, upload, and removal behavior from `WorkspaceView`.
- [x] Create `src/components/MattersView.tsx` as the initial separate Matter section using the existing Matter records and open/create affordances pending Phase 4 expansion.
- [x] Create `src/components/SettingsView.tsx` with name/email display and logout only.
- [x] Retire frontend use of the combined `WorkspaceView`; its file remains temporarily for rollback/reference and has no application import.
- [x] Rename visible Wide Library/Workspace & Library terminology to Firm Library in the affected Phase 3 surfaces.
- [x] Add static navigation/separation regression tests in `tests/product-upgrade.test.ts`.

Database migrations: none.  
API changes: none; reuse owned `/api/cases`, `/api/documents`, and `/api/search`.  
Backfill: none.  
Reusable capabilities: document grid, semantic/keyword search, section browser, preview, upload, delete, sidebar collapse, account footer.

Manual verification: navigate all global sections; confirm Firm Library has no Matter list/create/scope controls; upload/search/preview/remove an owned workspace document; confirm temporary global Drafts still opens.  
Completion: Matters and Firm Library are independent global views and Firm Library remains workspace-only.  
Rollback/failure: revert only the Phase 3 frontend commit; no data/schema state changes.

## Phase 4 — Matter Core

### Checklist

- [x] Add migration 005 for nullable Matter details (`client_name`, `client_email`, `matter_type`, `jurisdiction`, `preliminary_objectives`), suggestion flags, `updated_at`, and `last_activity_at`.
- [x] Extend migration 005 with Source metadata on documents (`source_type`, `origin`, `processing_state`) and link metadata on `case_documents` (`link_origin`, `added_at`), using safe defaults/backfill only.
- [x] Modify `server/db.ts` with owned Matter search/list/detail/update/create methods, status validation, last-activity updates, high-relevance Firm Library matching, owned link/unlink, and unified Source queries.
- [x] Modify `server.ts` with compatible Matter detail/update routes, stricter create validation, Source add/list/unlink routes, and owned suggestion confirm/edit/remove operations.
- [x] Extend `src/types.ts` for Matter metadata, suggestions, Sources, link origin, and processing state.
- [x] Expand `src/components/MattersView.tsx` with card/list modes, name/client search, allowed sorting, and the validated create form.
- [x] Create `src/components/MatterWorkspaceView.tsx` with Overview, Matter Intelligence placeholder, Sources, Work Product placeholder, and Collaboration placeholder tabs.
- [x] Create `src/components/MatterOverview.tsx` for the six approved fields, manual status, and confirm/edit/remove suggestion controls.
- [x] Create `src/components/MatterSources.tsx` for compact Source search/add/preview/remove and direct-vs-linked removal semantics.
- [x] Reuse Firm Library selection and document upload/paste paths for the required starting input.
- [x] Ensure creation fails before inserting a Matter unless assignment description and one starting input are present.
- [x] Store pasted starting notes as owned direct Matter Source documents; upload inputs through the existing embedding path; link selected Firm Library inputs without copying.
- [x] Label automatic links `AI Suggested`, use a bounded similarity threshold/count, and never generate Intelligence during creation.
- [x] Add migration/query/route tests for validation, statuses, owned update, matching SQL, Source classification, and unlink semantics.

Backfill: existing Matters receive safe `Open`/existing status, timestamps derived from creation/activity, nullable detail fields, and existing direct documents/links receive non-destructive Source defaults. No ambiguous document or redundant link is rewritten.  
Reusable capabilities: current Case APIs/types, upload/embedding, vector search, preview, and Matter-scoped document list/delete.

Manual verification: create a Matter with note, upload, and selected-library variants; reject no-input creation; search/sort/switch layouts; update Overview/suggestions/status; inspect unified Sources; remove a link without deleting its library document; verify cross-Matter IDs fail.  
Completion: owned Matter create/search/sort/open/update, five tabs, functional Overview/Sources, and no retrieval regression.  
Rollback/failure: migration columns remain harmless if frontend/server commit is reverted; never remove or rewrite Source records.

## Phase 5 — Assistant and History Context

### Checklist

- [ ] Modify `src/components/AssistantView.tsx` to show a persistent General/Matter selector and selected-context banner using Matter language.
- [ ] Modify `src/App.tsx` so context transitions clear incompatible active threads and History opening restores the stored context.
- [ ] Modify `src/components/HistoryView.tsx` to group General Assistant and one section per Matter, each sorted by recent activity.
- [ ] Modify `server/db.ts` history ordering to use latest message activity while preserving stored thread context as authoritative.
- [ ] Modify `server.ts` only where response metadata is needed; do not weaken established search/thread ownership.
- [ ] Add tests asserting General/Matter visible language, grouping, context clearing, stored-context restoration, and unchanged SQL isolation.

Database migrations: none unless a non-destructive activity index is demonstrably needed; prefer existing timestamps.  
Backfill: none; existing General and Matter threads already carry authoritative `case_id`/scope.  
Reusable capabilities: Assistant selector/thread state, History fetch/delete/open, owned thread/search APIs.

Manual verification: start/open/delete General and two Matter conversations; change selector while a thread is active; confirm no incompatible messages remain; verify grouping/order.  
Completion: every conversation is visibly General or exactly one Matter and retrieval remains isolated.  
Rollback/failure: revert Phase 5 UI/query changes; thread records are unchanged.

## Phase 6 — Work Product Migration

### Checklist

- [ ] Add migration 006 extending `drafts` with `updated_at`, `shared_with_client`, `shared_at`, `origin`, nullable self-referencing `parent_draft_id`, and `revision_type`.
- [ ] Backfill `updated_at` from `created_at`, `origin` from legacy/thread context, and retain every existing Matter assignment including the imported legacy Matter.
- [ ] Modify `server/db.ts` with owned create, duplicate, share/stop-share, and revision-copy methods; continue deriving Matter from the owned thread or validated Matter.
- [ ] Modify `server.ts` with Matter-scoped Work Product list/create/read/update/export/duplicate/share routes while retaining compatible existing draft routes for the editor during transition.
- [ ] Refactor `src/components/DraftEditorView.tsx` for Matter-only embedding, metadata display, duplicate/share controls, and unchanged Markdown/save/export behavior.
- [ ] Integrate Work Product into `MatterWorkspaceView`; add a simple create-draft action and retain Assistant generation navigation.
- [ ] Remove global Drafts navigation and routing only after all existing drafts are reachable through their Matters.
- [ ] Implement Client Revision copy semantics without exposing a portal editor until Phase 9.
- [ ] Add tests for backfill, Matter ownership, duplicate, share/unshare, parent linkage, deletion survival, and no Source-document creation.

Manual verification: open legacy/imported Work Product, edit/save/export, create/duplicate/share/unshare, generate from a Matter conversation, delete origin thread, and verify no document row appears.  
Completion: every Work Product is Matter-scoped; global Drafts is removed; originals survive and revisions are copies.  
Rollback/failure: additive columns/routes are safe; retain compatibility endpoints until Phase 10 cleanup.

## Phase 7 — Matter Intelligence

### Checklist

- [ ] Add migration 007 creating one owned-through-Matter `matter_intelligence` record with content, source snapshot JSON, generated/edited timestamps, and internal version.
- [ ] Modify `server/db.ts` for owned load/save/generate snapshot operations and Source-change comparison.
- [ ] Modify `server.ts` with owned GET, explicit generate/regenerate, and save endpoints; build prompts only from active Sources returned by Matter-scoped SQL.
- [ ] Create `src/components/MatterIntelligence.tsx` with initial action, five sections, review warning, edit/save/regenerate, dates, and Source-changed warning.
- [ ] Integrate the page into the existing Matter Intelligence tab.
- [ ] Add tests for explicit-only generation, owned Matter lookup, source snapshot/version behavior, edit save, and cross-Matter prompt isolation.

Backfill: none; existing Matters begin with no Intelligence.  
Reusable capabilities: Gemini model call, Source text/citations, Matter workspace tabs, owned Matter lookup.

Manual verification: confirm no automatic generation, generate from known Sources, edit/save/regenerate, add/remove Source and observe warning, and try a foreign Matter ID.  
Completion: explicit, source-backed, editable, versioned Intelligence cannot cross Matter/workspace boundaries.  
Rollback/failure: generation is transactional at record write; existing Sources remain untouched and the additive table may remain unused.

## Phase 8 — Collaboration

### Checklist

- [ ] Add migration 008 for one `client_access` row per Matter, token hash/status/revocation fields, `collaboration_requests`, request-document links, `client_responses`, and response-document links.
- [ ] Add ownership-path indexes and constraints without deleting duplicate legacy data.
- [ ] Modify `server/db.ts` for owned invite create/rotate/revoke, shared Work Product summary, request create/list, response list, and unread/read state.
- [ ] Modify `server.ts` with lawyer-authenticated Collaboration APIs; return the raw invite token only at generation time and never log/store it.
- [ ] Create `src/components/MatterCollaboration.tsx` for invite fields, generate/copy/revoke, shared documents, requests, responses, and a small unread indicator.
- [ ] Integrate Collaboration into `MatterWorkspaceView` and prefill client details from Matter metadata.
- [ ] Reuse Work Product share flags and Matter ownership checks; do not create a parallel document store.
- [ ] Add tests for token hashing/randomness, one-client constraint, ownership, request document validation, response visibility, unread state, and immediate revocation.

Backfill: none; existing Matters have no client access/request rows.  
Manual verification: invite one client, copy/rotate/revoke link, share Work Product, send each supported request type, and verify response/unread summaries with owned fixtures.  
Completion: one revocable Matter-specific collaborator, shared-document summary, requests, and responses.  
Rollback/failure: revoke generated access before reverting UI; additive collaboration rows do not alter Matter/Work Product ownership.

## Phase 9 — Client Portal

### Checklist

- [ ] Add migration 009 for portal comments and temporary client-assistant documents/conversations only where required; keep response uploads as owned Matter Source documents.
- [ ] Add separate portal-token middleware in `server.ts` that hashes the supplied token and resolves exactly one active Matter without creating an internal session.
- [ ] Add portal APIs for summary, shared Work Product view/download/comment/edit-copy, request view/respond, client upload/existing-document selection, and Client Revision creation.
- [ ] Add a strictly allow-listed Client Assistant endpoint that accepts selected permitted portal document IDs/temporary text and builds context without Firm Library, Intelligence, lawyer thread, web, or connector access.
- [ ] Modify `server/db.ts` with token-scoped portal methods whose SQL begins from active `client_access` and joins only explicitly shared/request/revision/client-submission records.
- [ ] Create `src/components/ClientPortalView.tsx` with Shared Documents, Requests, and Assistant tabs only.
- [ ] Modify `src/App.tsx` to render the public token route separately from lawyer authentication without exposing the token in logs or persistent client storage beyond the URL/session lifetime.
- [ ] Mark response uploads as `Client Submission`; keep Assistant-only uploads temporary unless explicitly attached to a response.
- [ ] Add tests for revoked/invalid tokens, one-Matter scope, unshared Work Product denial, copy-not-overwrite, request response, Source labeling, and Client Assistant allow-list SQL/prompt inputs.

Backfill: none.  
Reusable capabilities: DOCX export, draft duplicate/parent linkage, Source upload/chunking, Gemini grounded response formatting, Collaboration token hash.

Manual verification: use invite URL in a logged-out browser, exercise all three tabs, edit a copy, respond/upload, verify lawyer view/unread, ask Assistant about allowed and disallowed content, revoke and retry every route.  
Completion: portal access is one-token/one-Matter, displays only explicit content, preserves originals, and grounds Assistant only in selected permitted documents.  
Rollback/failure: revoke access tokens first; temporary records are additive and Matter data remains intact.

## Phase 10 — Cleanup and Hardening

### Checklist

- [ ] Search all visible frontend strings and remove obsolete Case/Wide Library/Workspace & Library/global Draft terminology.
- [ ] Remove unused combined workspace/global Draft frontend files and compatibility UI paths; retain server compatibility aliases only where existing clients may depend on them.
- [ ] Remove or relabel misleading simulated controls, version selectors, OAuth/file connectors, change tracking, and other placeholders that conflict with completed behavior.
- [ ] Clearly label retained CourtListener/GovInfo local connectors as simulated; never imply live integration.
- [ ] Audit every new query for internal-session or portal-token ownership and SQL-before-ranking filtering.
- [ ] Add comprehensive migration, auth/logout, direct-ID, cross-user, cross-Matter, Firm Library, revocation, Client Revision, Work Product survival, Intelligence, and Client Assistant isolation tests.
- [ ] Run full smoke verification without deleting validation fixtures or preserved ambiguous/redundant records.
- [ ] Update progress/final limitations with exact simulated integrations and retained records.

Database migrations: none expected; any discovered constraint/index need must be additive and separately justified.  
Manual verification: authenticated navigation, all Matter tabs, General/Matter Assistant/History, legacy Work Product, Intelligence, Collaboration, portal revocation, responsive/collapsed sidebar, and direct URL/ID attacks.  
Completion: all automated/manual gates pass, visible terminology is consistent, misleading placeholders are gone/labeled, and no isolation regression exists.  
Rollback/failure: cleanup is code-only and revertible; stop rather than weaken a security assertion or delete preserved records.
