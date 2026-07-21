# Foundation Phases 0–2 Live Verification

Verification date: 2026-07-21  
Branch: `upgrade/compact-v1`  
Database: configured PostgreSQL validation database with pgvector (URL intentionally omitted)  
Scope: Phase 0, Phase 1, and Phase 2 only. Phase 3 was not started.

This record is deliberately sanitized. It contains no database URL, password, session token, cookie value, API key, or other credential.

## Safety and environment gates

- The current branch was `upgrade/compact-v1` and the initial worktree was clean.
- No tracked `.env` file, database dump, credential, token, or recognized secret assignment was found.
- `SUPABASE_DB_URL`, `GEMINI_API_KEY`, `LEGACY_OWNER_USER_ID`, `LEGACY_OWNER_FIRM_ID`, and `LEGACY_OWNER_INITIAL_PASSWORD` were present through the application's normal dotenv loading. Values were not printed.
- `SEED_DEMO_DATA` was exactly `false` (case-insensitive check).
- Application/runtime output was inspected only through sanitized success flags and counts.

## Read-only pre-migration inspection

The inspection ran in a read-only PostgreSQL transaction before application startup or migration execution.

| Relation | Pre-migration rows |
|---|---:|
| `firm` | 1 |
| `users` | 1 |
| `cases` | 4 |
| `documents` | 18 |
| `document_chunks` | 208 |
| `case_documents` | 8 |
| `threads` | 42 |
| `messages` | 154 |
| `drafts` | 6 |
| `sessions` | Table did not exist |
| `schema_migrations` | Table did not exist |

Safety findings:

- The configured legacy User existed exactly once.
- The configured legacy Firm existed exactly once.
- The User belonged to the configured Firm.
- Case-insensitive duplicate-email groups: 0.
- Users with missing/invalid Firm ownership: 0.
- Matters with missing/invalid Firm ownership: 0.
- Documents with missing/invalid Firm ownership: 0.
- Documents whose Firm differed from their Matter's Firm: 0.
- Cross-Firm Case-document links: 0.
- Threads with missing/invalid Users: 0.
- Threads whose User and Matter belonged to different workspaces: 0.
- Draft/thread Matter disagreements before migration: 0.
- Drafts without a Matter: 5.
- Documents without chunks: 3.
- The 18 documents and 8 links would have been exposed to the former empty-chunk startup cleanup path. The replacement startup path did not delete them.

No ownership ambiguity, destructive correction, or cross-workspace inconsistency blocked the approved migrations.

## Migration and startup verification

Migrations 001–004 applied successfully in order:

1. `baseline_schema`
2. `preserve_drafts_when_threads_are_deleted`
3. `authentication_and_sessions`
4. `context_isolation_and_legacy_work_product`

Each version appears exactly once in `schema_migrations`. Two subsequent cold application starts emitted zero migration-application messages. The final restart reported demo seeding disabled, a listening server, and an empty runtime error log.

Immediate post-migration reconciliation:

| Relation | Before | After | Reconciliation |
|---|---:|---:|---|
| `firm` | 1 | 1 | Stable |
| `users` | 1 | 1 | Stable |
| `cases` | 4 | 5 | One required imported Matter |
| `documents` | 18 | 18 | No deletion |
| `document_chunks` | 208 | 208 | No deletion |
| `case_documents` | 8 | 8 | No deletion |
| `threads` | 42 | 42 | No deletion |
| `messages` | 154 | 154 | No deletion |
| `drafts` | 6 | 6 | No deletion |
| `sessions` | n/a | 0 | New empty table |
| `schema_migrations` | n/a | 4 | Versions 001–004 |

The five null-Matter drafts were assigned to one `Imported Legacy Work Product` Matter with status `On Hold`. Their existing originating General thread references were retained, as required. This creates five intentional legacy rows where the draft now has the imported Matter while its preserved originating thread remains General; it is not a cross-workspace mismatch.

The HNSW vector index kept the same PostgreSQL object and relfilenode identity across migration and repeated restarts. It was not routinely dropped or rebuilt. The three pre-existing documents without chunks remained present. No demo record was created with `SEED_DEMO_DATA=false`.

After live test fixtures were added, a further cold restart preserved identical counts (`firm` 5, `users` 5, `cases` 9, `documents` 24, `document_chunks` 214, `case_documents` 10, `threads` 48, `messages` 159, `drafts` 12, `sessions` 8, `schema_migrations` 4) and the same vector-index identity.

## Legacy-account verification

- Login with the configured legacy account and initial password succeeded; the password was not printed.
- The authenticated API exposed exactly the legacy workspace's expected Matters, Firm Library documents, conversations, and Work Product.
- No unrelated workspace record was assigned to the legacy owner.
- All five null-Matter drafts moved to the one imported `On Hold` Matter; no draft was deleted.
- Four exact generated-draft duplicate documents were classified and excluded from normal Sources without deletion.
- Two additional draft-like documents did not meet the exact title/content/Matter match and were preserved unclassified for manual review.
- Six redundant legacy links involving direct Matter documents remain preserved and were not modified.

Successful migration means `LEGACY_OWNER_INITIAL_PASSWORD` should now be removed from the runtime environment.

## Authentication verification

Two temporary accounts were created through `POST /api/auth/signup`; each received a distinct empty workspace and an authenticated server-side session.

For both accounts:

- Signup succeeded.
- `/api/auth/me` confirmed session persistence.
- Initial Matter, Firm Library, History/conversation, and draft lists were empty.
- A case-variant duplicate signup was rejected with HTTP 409.
- Wrong-password and nonexistent-account logins returned the same HTTP 401 error shape.
- Logout returned success, removed the server-side session, and made the former cookie unable to access a protected route (HTTP 401).
- Login after logout succeeded.

Cookie security attributes and token handling are also covered by the passing automated tests: HTTP-only, `SameSite=Lax`, production-only `Secure`, secure random raw tokens, and hash-only session storage.

## Ownership and direct-ID verification

A separate destructive-test pair was created, with two Matters per workspace, distinct conversations, messages, documents, and Work Product.

The following substitutions all produced safe HTTP 404 responses or empty scoped lists:

- A foreign Matter ID in document and thread listings.
- A foreign document ID and Matter ID in deletion.
- An owned document ID paired with the wrong owned Matter ID.
- A foreign thread ID in message read and thread deletion.
- A foreign message ID/thread pair in update.
- A foreign draft ID/Matter pair in read, update, and export.
- An owned draft ID paired with the wrong owned Matter.
- A Firm Library document unlink attempted through the wrong Matter.
- Upload attempted with another workspace's Matter ID.
- Search attempted with another workspace's Matter ID (empty result).

Database snapshots before and after the substitutions confirmed that the foreign document, thread, message, draft, and intended Case-document link were unchanged. There is currently no direct Matter-by-ID read route, direct document-by-ID read route, or public Case-document link-creation route; the exposed list/delete/unlink paths were tested instead.

## Retrieval and Firm Library verification

Each destructive-test workspace received one Firm Library document and one direct document in each of two Matters through the production upload endpoint. All six deterministic documents received real Gemini-generated chunks; no random embedding fallback was used. Each Firm Library document was linked only to Matter A for its workspace.

All seven search requests returned HTTP 200 and demonstrated:

- Firm Library lists contained only the authenticated workspace's documents with `case_id IS NULL`.
- General search retrieved the workspace's Firm Library document.
- General search did not return either direct Matter document.
- Matter A retrieved its own direct document and its linked Firm Library document.
- Matter A did not retrieve Matter B's direct document.
- Matter B did not retrieve Matter A's direct document.
- Matter B did not retrieve the Firm Library document because it was not linked there.
- A foreign workspace Matter scope returned no results.
- Neither workspace received the other's documents.
- Matter Source lists followed the same direct-or-linked classification.

The passing query-shape regression tests additionally confirm that workspace, `case_id`, link, and generated-duplicate predicates occur in SQL before vector distance ordering and limiting. Sensitive rows are not retrieved globally and filtered afterward.

## Conversation and Work Product verification

- General thread lists contained only General threads for the authenticated user.
- Matter A and Matter B lists contained only the selected Matter's threads.
- History returned stored General threads with `case_id = NULL`/`scope = wide` and Matter threads with their stored `case_id`/`scope = case`; stored context is authoritative when opened.
- The existing Assistant selector clears `activeThreadId` before changing context; this remains a frontend state transition and was verified in the Phase 2 implementation path rather than through a browser automation suite.
- A General conversation with a message could not generate Work Product and returned HTTP 400 requiring a Matter.
- Actual generated Work Product returned HTTP 201 and retained the correct originating thread and Matter.
- Generating that Work Product did not increase the Source/document count.
- Deleting a separate originating conversation returned success, retained its Work Product, set `drafts.thread_id` to null, and preserved `drafts.case_id`.

## Automated verification

- `npm test`: passed, 9/9 tests.
- `npm run lint`: passed (`tsc --noEmit`).
- `npm run build`: passed (Vite production frontend plus esbuild server bundle; 1,841 modules transformed).

No Phase 0–2 defect was found, so no `fix(foundation):` commit or regression-test change was required.

## Remaining limitations and manual action

- The validation database now intentionally contains four temporary test accounts. Two are authentication-only; two contain the isolation fixtures described above. They were not deleted because this task forbids destructive cleanup without explicit authorization.
- Two ambiguous draft-like legacy documents remain preserved and unclassified; review them manually before deciding whether they are duplicates.
- Six redundant legacy Case-document links remain preserved, per the approved rules.
- Browser automation is not configured. The server-authoritative history context was verified live, while the incompatible-thread clearing behavior was verified in the existing frontend implementation.
- No Phase 3 navigation separation or later feature was implemented.

Required action before Phase 3: remove `LEGACY_OWNER_INITIAL_PASSWORD` from the runtime environment, restart the application, and confirm normal legacy login still succeeds with the already stored password hash. Retain a database backup and review the two ambiguous preserved draft-like documents; neither item requires an automatic data mutation.
