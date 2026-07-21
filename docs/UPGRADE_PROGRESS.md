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
