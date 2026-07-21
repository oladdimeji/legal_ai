# Legal AI Audit Review Notes

**Review status:** Proceed with corrections  
**Reviewed artifact:** `docs/CODEBASE_AUDIT.md`

The audit is accepted as an accurate description of the current repository. The compact upgrade may proceed after the binding decisions below are applied.

## 1. Dependency Installation Is Permitted

The audit could not run TypeScript or the production build because dependencies were not installed.

For implementation tasks:

- If `package-lock.json` exists, run `npm ci`.
- If no lockfile exists, run `npm install` without intentionally changing dependency versions.
- Do not commit `node_modules`.
- Do not upgrade, replace, or add dependencies unless the requested phase genuinely requires it and the change is reported.
- A missing local dependency installation is an environment issue, not a source-code lint failure.

After dependencies are installed, establish the real baseline by running:

- `npm run lint`
- `npm run build`

## 2. Phase 0 Must Neutralize Destructive Startup Behavior

Before authentication or feature work, remove the risk that application startup deletes or mutates existing data unexpectedly.

Required behavior:

- Never delete documents, document links, or chunks merely because `document_chunks` is empty.
- Demo seeding must be explicit and disabled by default, for example through `SEED_DEMO_DATA=true`.
- Do not drop and recreate the vector index on every startup.
- Move schema changes toward numbered, repeatable, non-destructive migrations.
- Do not silently substitute random embeddings when embedding generation fails.
- An embedding failure should leave the document unindexed or marked as needing attention.
- Do not reset or reseed existing production-like data.

Phase 0 is not complete until these startup risks are removed or safely guarded.

## 3. Existing Account Migration Must Be Deterministic

Do not use `SELECT ... LIMIT 1` to choose the owner of existing records.

Use protected environment variables such as:

- `LEGACY_OWNER_USER_ID`
- `LEGACY_OWNER_FIRM_ID`
- `LEGACY_OWNER_INITIAL_PASSWORD`

For the current prototype, these may point to the existing seeded IDs only when those exact records are confirmed to exist.

Migration rules:

- Verify that the supplied User belongs to the supplied Firm.
- Verify that existing legacy records intended for migration belong to that Firm or are explicitly included by the migration.
- Hash the initial password before storing it.
- Never log the plain password.
- Fail safely when the supplied IDs are missing, inconsistent, or ambiguous.
- Do not automatically choose another record as a fallback.
- After migration, all normal requests must derive User and Firm from the authenticated session.

## 4. Firm Library and Matter Source Classification

Use the existing data model non-destructively.

Interpret records as follows:

- `documents.case_id IS NOT NULL`: direct Matter upload or Matter-owned document.
- `documents.case_id IS NULL`: Firm Library document.
- A Firm Library document connected through `case_documents`: linked Firm Library source for that Matter.

Do not delete existing `case_documents` rows merely because some are redundant.

Ownership and scope must be enforced in SQL before vector ranking or result limiting.

## 5. Legacy Drafts Without a Matter

New Work Product must always belong to a Matter.

For existing drafts where `case_id IS NULL`:

- Preserve every draft.
- Create one Matter named `Imported Legacy Work Product` for the migrated workspace only when such drafts exist.
- Assign those legacy drafts to that Matter.
- Mark the Matter `On Hold`.
- Record the migration in the progress report.
- Do not silently discard or hide the drafts.

## 6. Drafts Must Survive Conversation Deletion

The current thread-to-draft cascade is incompatible with durable Matter Work Product.

During the foundation work:

- Change the `drafts.thread_id` deletion behavior from cascade to `SET NULL`, or implement an equivalent non-destructive relationship.
- Verify that deleting a conversation does not delete its Work Product.
- Preserve `case_id` or Matter ownership on the draft.
- Keep the originating thread reference when the thread still exists.

This should be corrected before users begin testing authenticated deletion behavior.

## 7. Generated Draft Documents

Going forward, Work Product must not automatically become a Matter Source or Firm Library document.

For new generation:

- Save generated drafts as Work Product only.
- Do not create a parallel Source document unless the lawyer deliberately adds or exports it as a source later.

For existing parallel draft documents:

- Preserve them.
- Classify or link them only when the match to a draft is reliable.
- Do not delete or merge ambiguous records.
- Report unmatched legacy records for later review.
- Exclude confidently identified generated-draft duplicates from Firm Library and normal Matter Sources.

## 8. History and Assistant Context

Server-side ownership and context are mandatory.

Additionally:

- Opening a Matter conversation from History must restore that Matter as the visible Assistant context.
- Opening a General conversation must restore General context.
- General thread listing must include only `case_id IS NULL` conversations owned by the authenticated user.
- Matter thread listing must include only conversations for that Matter and authenticated workspace.
- The stored thread context remains authoritative for message retrieval.

## 9. Authentication Scope

Keep authentication deliberately compact:

- Name, email, and password signup.
- Email and password login.
- Logout.
- HTTP-only server-side session cookie.
- No verification, password reset, social login, MFA, teams, or roles.
- Every signup creates a separate empty workspace.
- Email uniqueness must be case-insensitive.
- Passwords must use a secure password-hashing function.
- All protected routes must reject unauthenticated requests.

## 10. Foundation Acceptance Tests

Before Phase 3 begins, verify at minimum:

1. A new signup starts with no Matters, documents, conversations, or drafts.
2. Two users cannot read, update, delete, search, or export each other's records.
3. General Assistant cannot retrieve direct Matter documents.
4. One Matter cannot retrieve another Matter's documents, conversations, or drafts.
5. Firm Library returns only workspace-owned documents with no direct Matter ownership.
6. Search scope is applied in SQL before ranking and limiting.
7. Direct ID manipulation returns a safe not-found or forbidden response.
8. Existing legacy records remain available to the migrated original account.
9. Deleting a conversation does not delete Work Product.
10. Starting the server does not delete documents or rebuild seed data unexpectedly.
11. `npm run lint` passes.
12. `npm run build` passes.

## 11. Review Verdict

The audit is sufficiently thorough and correctly identifies the main risks.

**Decision:** Proceed with Foundation Phases 0–2 after these review notes are added to the repository and referenced by the Codex execution task.

Do not begin navigation or product-feature phases until the foundation acceptance tests pass.