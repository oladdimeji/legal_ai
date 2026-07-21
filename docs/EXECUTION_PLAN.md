# Foundation Execution Plan — Phases 0–2

This checklist implements only the approved foundation phases. Phase 3 navigation separation and all later product features are excluded.

## Global gates

- [x] Read `AGENTS.md`, compact plan, codebase audit, and audit review notes.
- [x] Use `npm install` because no `package-lock.json` existed at preparation time.
- [x] Capture pre-change `npm run lint` and `npm run build` results.
- [ ] Complete each phase sequentially; lint, test, build, progress update, and separate commit before continuing.
- [ ] Never delete/reset existing data or choose a legacy owner implicitly.
- [ ] Stop on destructive migration need, missing/ambiguous legacy owner, unavailable database capability, unresolved check failure, or security conflict.

## Phase 0 — Preserve and protect the baseline

### Files

- [x] Add `server/migrations.ts` with numbered, transactional, advisory-locked migrations.
- [x] Update `server/db.ts` startup, seeding, embeddings, and draft generation behavior.
- [x] Update `server.ts` to run safe initialization and opt-in demo seeding.
- [x] Document `SEED_DEMO_DATA=false` in `.env.example`.
- [x] Add focused migration tests and a test script.
- [x] Create/update execution and progress documentation.
- [x] Commit generated `package-lock.json`; never commit `node_modules` or `dist`.

### Database migrations and data protection

- [x] Migration 001 creates the existing baseline schema with `IF NOT EXISTS` and creates the vector index only if missing.
- [x] Migration 002 changes `drafts.thread_id` to `ON DELETE SET NULL` without changing draft data.
- [x] Record each applied migration once in `schema_migrations`; roll back a failing migration.
- [x] Never drop/rebuild the vector index or alter vector dimensions on routine startup.
- [x] Never clear documents, chunks, or Case links based on chunk counts.
- [x] Demo seeding is disabled unless `SEED_DEMO_DATA=true`, repeatable, and additive only.
- [x] Failed embeddings leave affected chunks unindexed; no random-vector fallback.
- [x] New generated drafts do not create parallel Source documents.

### Verification and rollback

- [x] Run focused tests, lint, and build.
- [x] Verify by code path that startup with seeding unset returns before any demo insert and contains no cleanup delete.
- [ ] Rollback strategy: revert application commit; migrations are forward-only and non-destructive. Migration 002 may be reversed only by a reviewed forward migration, never by deleting Work Product.

## Phase 1 — Authentication and ownership identity

### Files and authentication surface

- [x] Add password/session utilities using Node cryptography (no external auth provider).
- [x] Add Express authentication middleware and typed authenticated context.
- [x] Add `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`.
- [x] Protect all non-health API routes and the application shell.
- [x] Add monochrome login/signup screens and signed-in account/logout controls.
- [x] Update shared User/Firm types and environment documentation.

### Database migrations and legacy migration

- [x] Add `users.password_hash`, `users.created_at`, and `users.updated_at` non-destructively.
- [x] Add case-insensitive unique email index, failing safely if legacy duplicates exist.
- [x] Add server-side `sessions` table with token hash, user, creation, expiry, and last-used timestamps.
- [x] Validate `LEGACY_OWNER_USER_ID`, `LEGACY_OWNER_FIRM_ID`, and `LEGACY_OWNER_INITIAL_PASSWORD` as an all-or-none set.
- [x] Verify exact legacy user/firm relationship and legacy record consistency before hashing/storing the supplied initial password.
- [x] Never select a first/default/fallback user or firm and never log a password/token.
- [x] New signup transaction creates exactly one new firm, one user, and one session; new workspace starts empty.

### Session behavior

- [x] Hash passwords with salted `scrypt`; compare using constant-time equality.
- [x] Generate secure random session tokens and store only a SHA-256 token hash.
- [x] Use an HTTP-only, `SameSite=Lax` cookie; add `Secure` in production.
- [x] Enforce expiry server-side; logout deletes the session row and clears the cookie.
- [x] Return uniform invalid-credential errors and safe duplicate-email errors.

### Verification and rollback

- [x] Test password hashing, token hashing, cookie parsing, and cookie attributes; database-backed signup/session tests remain manual.
- [x] Run tests, lint, and build.
- [ ] Manual verification: signup, refresh persistence, logout, invalid login, duplicate email, protected API/application response.
- [ ] Rollback strategy: revert application commit while retaining additive auth columns/tables; do not erase hashes/sessions or legacy data.

## Phase 2 — Ownership and context isolation

### Ownership-aware database methods

- [x] Every Case read/create validates authenticated `firm_id`.
- [x] Every document list/read/upload/delete validates workspace and optional Matter ownership.
- [x] Every Case-document link joins through an owned Matter and owned Firm Library document.
- [x] Every thread list/read/create/delete validates authenticated user and workspace Matter access.
- [x] Every message read/create/update validates ownership through its thread.
- [x] Every draft list/read/create/update/export validates ownership through its Matter/workspace.
- [x] Imported null-Matter legacy drafts move to one `Imported Legacy Work Product` Matter (`On Hold`) only for the verified legacy workspace.
- [x] Preserve redundant Case-document links and ambiguous legacy generated-draft documents.

### Search and retrieval isolation

- [x] General/Firm Library SQL requires authenticated `firm_id` and `documents.case_id IS NULL` before vector ordering/limit.
- [x] Matter SQL requires the owned Matter and includes only direct Matter documents plus linked Firm Library documents.
- [x] Section suggestion and automatic linking never inspect another workspace or direct Matter documents.
- [x] Similarity threshold is applied only after ownership/context predicates and ranking/limit are safe.
- [x] General thread/draft listings exclude Matter contexts; Matter listings require the exact owned Matter.
- [x] Stored thread context remains authoritative for messages and draft generation.
- [x] Opening History restores General or the exact stored Matter context.

### Direct-ID and route protection

- [x] Treat every URL/body ID as an object selector only, never as ownership.
- [x] Return safe empty/404 responses for foreign Case, document, thread, message, and draft IDs.
- [x] Do not accept user/firm ownership fields from frontend bodies.
- [x] Ensure exports and deletes use the same ownership joins as reads.
- [x] Deleting a conversation preserves drafts with their Matter ownership.

### Verification and rollback

- [x] Add SQL/query-shape and integration-focused tests where database-independent testing is practical.
- [ ] Verify two-user, two-Matter isolation; General exclusion; Firm Library classification; direct-ID denial; history restoration; and Work Product survival.
- [x] Run tests, lint, and build.
- [ ] Rollback strategy: revert application commit while retaining additive/backfill migrations; never reverse ownership by deleting records.

## Deferred beyond this plan

- Phase 3 navigation split, Matter cards/lists, Settings, Matter Intelligence, collaboration, Client Portal, and Work Product feature expansion.
