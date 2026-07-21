# LEGAL AI — COMPACT UPGRADE BUILD PLAN

**Draft Version:** 0.2
**Purpose:** Upgrade the current Legal AI application into a simple Matter-centered legal workspace while preserving the existing application, current data, and monochrome user interface.

---

## 1. Core Upgrade Direction

The current application will remain the foundation.

This upgrade will:

* Preserve working features.
* Rename and reorganize existing features.
* Separate Matters from the Firm Library.
* Move drafts into their relevant Matters.
* Add simple user authentication and data ownership.
* Add compact Matter Intelligence.
* Add controlled client collaboration.
* Add a simple Client Portal.
* Avoid unnecessary workflows, statuses, administration, and automation.
* Be implemented one feature at a time without breaking the working application.

This is not a rebuild.

The database may continue using existing internal names such as `cases` and `case_id` during the first upgrade. The visible product language will change to **Matter**, but destructive database renaming is not required.

---

## 2. Visual and Technical Rules

The current interface must remain recognizable.

### Preserve

* White primary background.
* Near-black text.
* Grayscale panels and borders.
* Existing typography.
* Existing spacing style.
* Existing icon style.
* Existing collapsible sidebar.
* Existing conversational interface.
* Existing draft editor.
* Existing responsive behavior.

### Do Not Introduce

* A new visual identity.
* Decorative gradients.
* Large colored dashboards.
* Complex animations.
* A different component library.
* A general application rewrite.
* Unrelated code refactoring.

Blue or other accent colors may remain only where already used for restrained primary actions, links, or status clarity.

---

## 3. Authentication and User Ownership

Simple authentication will be added before the main structural upgrade.

### 3.1 Authentication Pages

The application will have two public screens:

#### Sign Up

Fields:

* Name.
* Email.
* Password.

#### Log In

Fields:

* Email.
* Password.

The pages should use the same white, black, and grayscale design as the main application.

### 3.2 Included Authentication Behavior

* Email and password signup.
* Email and password login.
* Logout.
* Persistent signed-in session.
* Protected application routes.
* Protected API routes.
* Clear invalid-credentials messages.
* Duplicate-email prevention.
* Passwords stored as secure password hashes.
* Session stored using a secure HTTP-only cookie.

### 3.3 Deliberately Excluded

The testing version will not include:

* Email verification.
* Google login.
* Microsoft login.
* Magic links.
* Multi-factor authentication.
* Password reset.
* Remember Me.
* Team invitations.
* Multiple internal users in one workspace.
* User roles.
* Firm administrators.
* Account deactivation.
* Subscription or billing controls.

### 3.4 New Signup Ownership

Every new signup creates:

* One User.
* One private Workspace or Firm record belonging to that User.
* An authenticated session.

The user begins with:

* No Matters.
* No Firm Library documents.
* No conversations.
* No Matter Intelligence.
* No Work Product.
* No client invitations.
* No collaboration requests.

A default empty-state screen will guide the user to either:

* Create a Matter.
* Upload a Firm Library document.
* Start a General Assistant conversation.

### 3.5 Existing Application Data

Existing data must not be deleted.

During migration:

* The existing user becomes the owner of the existing workspace.
* Existing Matters, documents, conversations, and drafts remain assigned to that workspace.
* A password hash must be assigned to the existing user before the authentication gate is enabled.
* The initial migration password should be supplied through a protected environment variable or deployment secret.
* New accounts must never see the existing account’s data.

### 3.6 Minimum Authentication Database Changes

Extend the existing `users` table with:

* `password_hash`.
* `created_at`.
* Optional `updated_at`.

Add a case-insensitive unique email constraint.

Add a small `sessions` table containing:

* Session ID or token hash.
* User ID.
* Created date.
* Expiration date.
* Optional last-used date.

Passwords must never be stored or logged in plain text.

### 3.7 Session Rules

* Use an HTTP-only session cookie.
* Use `SameSite=Lax` or stronger.
* Use the `Secure` cookie flag in production.
* Expire inactive or old sessions after a reasonable testing period.
* Logout must invalidate the server-side session.
* Authentication must be verified by the server, not only by frontend state.

### 3.8 Required Authentication Endpoints

Minimum endpoints:

* `POST /api/auth/signup`
* `POST /api/auth/login`
* `POST /api/auth/logout`
* `GET /api/auth/me`

No additional account-management endpoints are required during this upgrade.

### 3.9 Data Isolation

Authentication is not complete merely because a login page exists.

Every protected database action must use the authenticated User and Workspace context.

The current pattern of selecting the first User or Firm in the database must be removed.

Every Matter, document, conversation, message, draft, search, upload, edit, and delete operation must verify ownership on the server.

A user must never be able to access another user’s data by changing:

* A Matter ID.
* A document ID.
* A conversation ID.
* A draft ID.
* A URL.
* An API request body.

For this upgrade, each user owns a separate workspace. This provides simple isolation without introducing roles or internal team permissions.

---

## 4. Target Global Navigation

The authenticated application sidebar will contain:

1. **Assistant**
2. **Matters**
3. **Firm Library**
4. **History**
5. **Settings**

The account area will display:

* User name.
* User email.
* Logout.

### Navigation Changes

* **Workspace & Library** will be separated into **Matters** and **Firm Library**.
* **Drafts & Documents** will be removed from the global sidebar.
* Drafts will move into the relevant Matter as **Work Product**.
* No Global Activity page will be created.
* Settings will remain minimal.

---

## 5. Firm Library

### 5.1 Purpose

The current Wide Library will become the Firm Library.

It will remain the private workspace-wide repository for reusable documents.

Because each testing user receives a separate workspace, their Firm Library will also be private to that account.

### 5.2 Changes

* Rename **Wide Library** to **Firm Library**.
* Rename the current global **Workspace & Library** navigation item.
* Remove the Cases or Matters sidebar from the library.
* Remove Create Case or Create Matter actions from the library.
* Remove Matter lists from the library.
* Retain the current document search.
* Retain semantic search.
* Retain document sections.
* Retain document preview.
* Retain upload.
* Retain document removal.
* Retain existing source and citation behavior.

### 5.3 Library Scope

The Firm Library must contain only firm-level documents where `case_id` is empty or the equivalent Matter link does not represent direct Matter ownership.

Matter-specific documents must not appear in the Firm Library.

Firm Library searches must also be restricted to the authenticated user’s workspace.

### 5.4 Deferred Firm Library Features

Do not add:

* Knowledge approval statuses.
* Advanced access levels.
* Team visibility.
* Practice-group visibility.
* Promotion workflows.
* Anonymization workflows.
* Complex document classifications.
* Advanced filters.
* Firm administration.

---

## 6. Matters

### 6.1 All Matters Page

The Matters page will support card and list views.

#### Matter Card

Display:

* Matter name.
* Client name, when available.
* Status badge.
* Last activity.

#### Matter List

Display:

* Matter name.
* Client.
* Status.
* Matter type or practice area.
* Last activity.
* Created date.

### 6.2 Matter Controls

Provide:

* Search by Matter name or client name.
* Sort by:

  * Last activity, default.
  * Created date.
  * Name.

Do not add advanced filters.

### 6.3 Matter Status

Use only:

* Open.
* Waiting for Client.
* On Hold.
* Closed.

New Matters begin as **Open**.

Status will be manually controlled. It will not automatically change when research, drafting, sharing, or client activity occurs.

### 6.4 Create Matter

Required fields:

* Matter name.
* Assignment description.
* At least one starting input.

Optional field:

* Client name.

A starting input can be:

* An uploaded document.
* A pasted instruction or note.
* One or more selected Firm Library documents.

A Matter cannot be created without at least one starting input.

### 6.5 Automatic Firm Library Matching

After creation:

* Search the authenticated user’s Firm Library using the Matter name and assignment description.
* Link a small number of highly relevant documents to Matter Sources.
* Label automatically linked documents **AI Suggested**.
* Allow the lawyer to remove irrelevant suggestions.
* Do not copy the Firm Library document.
* Do not search another user’s Firm Library.
* Do not generate Matter Intelligence automatically.

---

## 7. Matter Workspace

Every Matter will contain five tabs:

1. **Overview**
2. **Matter Intelligence**
3. **Sources**
4. **Work Product**
5. **Collaboration**

There will be:

* No Matter Assistant tab.
* No Matter Activity tab.
* No dedicated Matter dashboard.
* No additional nested navigation.

The global sidebar will remain visible while a Matter is open.

---

## 8. Matter Overview

The Overview will display only:

* Matter name.
* Client.
* Matter type or practice area.
* Jurisdiction.
* Preliminary objectives.
* Matter status.

### 8.1 Suggested Fields

The system may suggest:

* Matter type or practice area.
* Jurisdiction.
* Preliminary objectives.

Each suggestion can be:

* Confirmed.
* Edited.
* Removed.

Suggestions must remain visibly AI-generated until confirmed or edited by the lawyer.

### 8.2 Jurisdiction

Jurisdiction will remain because it directly affects:

* Legal research.
* Authority selection.
* Legal interpretation.
* Matter Intelligence.
* Assistant responses.

Do not separately add court, regulator, venue, governing law, or multiple-jurisdiction workflows during this upgrade.

---

## 9. Matter Intelligence

### 9.1 Generation

Matter Intelligence will not be generated automatically.

The initial page will contain one primary action:

**Generate Matter Intelligence**

Generation uses the Matter’s currently active Sources.

After generation, provide:

* Edit.
* Save.
* Regenerate.

When Matter Sources change, display:

**Sources have changed since this Matter Intelligence was generated.**

The lawyer decides whether to regenerate.

### 9.2 Intelligence Sections

Matter Intelligence will be one scrollable page with five sections.

#### 1. Matter Summary

Include:

* What the assignment concerns.
* What the client appears to need.
* Important parties or entities.
* Important context.
* Important uncertainty.

#### 2. Key Facts and Chronology

Include:

* Material facts.
* Important dates.
* Relevant events.
* Disputed facts.
* Uncertain facts.
* Supporting sources.

Facts and chronology will remain combined.

#### 3. Legal Issues and Authorities

Include:

* Main legal questions.
* Relevant jurisdiction.
* Relevant authorities.
* Legal propositions supported by those authorities.

Issue Map and Authority Record will remain combined.

#### 4. Analysis, Risks, and Preliminary Conclusions

Include:

* Application of facts to issues.
* Strong arguments.
* Counterarguments.
* Risks.
* Preliminary conclusions.

#### 5. Open Questions and Recommended Next Actions

Include:

* Missing information.
* Questions for the client.
* Missing documents.
* Research gaps.
* Practical next actions.

Do not add:

* Assignees.
* Due dates.
* Task statuses.
* Project-management workflows.

### 9.3 Intelligence Safeguards

* Material statements should link to Sources where possible.
* The page must state that AI-generated content requires lawyer review.
* Generated content must be editable.
* Save the generation date.
* Save the Sources used for generation.
* Save a simple internal version number.
* Do not create a large visible version-management interface.
* Do not add the detailed verification-state system from the larger build plan.

---

## 10. Matter Sources

Matter Sources will be one list containing everything supporting the Matter.

### 10.1 Source Types

* Starting instruction or note.
* Matter upload.
* Linked Firm Library document.
* Client submission.
* External legal source.
* External web source.

Generated Work Product will remain in Work Product and will not automatically become a Source.

### 10.2 Source Information

Display:

* Title.
* Source type.
* Origin.
* Date added.
* Processing state where necessary.

Use only:

* Processing.
* Ready.
* Needs Attention.

### 10.3 Source Controls

Provide:

* Search.
* Add Source.
* Open or preview.
* Remove from Matter.

No advanced filters are required.

Removing a linked Firm Library document removes only the Matter link. It must not delete the original Firm Library document.

Client-returned documents will appear as **Client Submission** Sources after processing.

---

## 11. Assistant

The Assistant will remain outside the Matter workspace.

### 11.1 Context Selector

The Assistant will provide a visible selector for:

* General.
* A specific Matter.

The selected context must always be clearly displayed.

### 11.2 General Context

General Assistant may use:

* The signed-in user’s Firm Library.
* Permitted external sources.

General Assistant must not retrieve:

* Matter uploads.
* Matter Intelligence.
* Matter conversations.
* Matter Work Product.
* Client submissions.
* Another user’s content.

### 11.3 Matter Context

When a Matter is selected, the Assistant may use:

* That Matter’s starting inputs.
* That Matter’s uploads.
* Linked Firm Library documents.
* Client submissions.
* Matter Intelligence.
* Permitted external sources.

It must never use:

* Another Matter’s information.
* Another user’s information.

### 11.4 Draft Generation

Retain the existing Generate Draft action.

When using a Matter context:

* Generated drafts are saved to that Matter’s Work Product.

When using General context:

* The lawyer must select or create a Matter before saving the generated draft.

There will be no global unassigned Drafts area.

---

## 12. Work Product

Work Product will reuse the existing Drafts & Documents experience inside each Matter.

### 12.1 Work Product List

Display:

* Document title.
* Last updated date.
* Origin, where relevant.
* Whether it is shared with the client.

### 12.2 Actions

Provide:

* Open.
* Edit.
* Save.
* Export to DOCX.
* Create draft.
* Generate draft.
* Duplicate.
* Share with client.
* Stop sharing.

### 12.3 Simplified Workflow

Do not add:

* Draft-review statuses.
* Reviewer assignments.
* Approver assignments.
* Formal approval.
* Delivery workflows.
* Factual-review states.
* Warning overrides.
* Superseded states.
* Complex version history.

### 12.4 Client Revisions

A client must never overwrite a lawyer’s document.

When the client selects **Edit a Copy**:

* Create a separate Work Product record or linked revision.
* Mark it as **Client Revision**.
* Link it to the original.
* Preserve the original unchanged.
* Make both documents available to the lawyer.

---

## 13. Collaboration

Collaboration is the lawyer’s Matter-specific client interaction area.

The compact upgrade supports one external client collaborator per Matter.

### 13.1 Invite Client

When no client has been invited, display:

**Invite Client Collaborator**

Form fields:

* Client name.
* Client email.

Use existing Matter client information as prefilled values where available.

### 13.2 Invitation Access

After submission, provide:

* Generate Invite Link.
* Copy Invite Link.
* Client name.
* Client email.
* Invitation status.
* Revoke Access.

The invite link must be:

* Matter-specific.
* Unguessable.
* Revocable.
* Restricted to the relevant Client Portal.

The client does not create a normal lawyer account through the public signup page.

### 13.3 Shared Documents

Display Work Product currently shared with the client.

Documents remain stored in Work Product. Collaboration only provides a summary and client-access controls.

### 13.4 Requests

The lawyer can create a request by:

* Selecting one or more Work Product documents.
* Adding a comment or instruction.
* Sending the request.

Requests may ask the client to:

* Review.
* Comment.
* Confirm information.
* Upload a document.
* Edit and return a copy.
* Provide a written response.

### 13.5 Client Responses

Responses may contain:

* Acknowledgement.
* Comment.
* Uploaded document.
* Selected portal document.
* Client Revision.
* Written answer.

Responses appear inside Collaboration.

A small unread indicator may appear on the Collaboration tab.

Do not create a global notification center.

---

## 14. History

The current Conversation History will remain.

It will be grouped by context.

### Groups

* One group for each Matter.
* One group named **General Assistant**.

Within each group, conversations will be ordered by most recent activity.

Retain:

* Open conversation.
* Delete conversation.

Opening a conversation must restore:

* The correct authenticated user.
* The correct Assistant context.
* The correct Matter where applicable.

Do not create:

* Matter Activity.
* Global Activity.
* Event filters.
* Audit dashboards.

---

## 15. Settings

Settings will remain minimal.

Include:

* Name.
* Email, read-only.
* Logout.

Optionally allow the user to edit their display name.

Do not add:

* Password change.
* Password reset.
* Workspace member management.
* Roles.
* Teams.
* Billing.
* Security dashboards.
* Firm administration.

Those can be added later when the product is beyond testing.

---

## 16. Client Portal

The Client Portal will be restricted to one Matter and contain:

1. **Shared Documents**
2. **Requests**
3. **Assistant**

There will be no Client Activity tab.

### 16.1 Shared Documents

The client can:

* View explicitly shared documents.
* Download where allowed.
* Add comments.
* Select **Edit a Copy**.

The lawyer’s original must remain unchanged.

### 16.2 Requests

The client can:

* View the request.
* Read the lawyer’s comment.
* Open connected documents.
* Acknowledge.
* Add a comment.
* Add a written answer.
* Upload a document.
* Select an existing portal document.
* Edit a copy.
* Send the response.

### 16.3 Client Assistant

The Client Assistant will support document understanding only.

The client can attach or select:

* A shared document.
* A request document.
* A Client Revision.
* An external file.

The Assistant may provide:

* Plain-language explanations.
* Summaries.
* Clause clarification.
* Answers grounded in selected documents.
* Links or citations to relevant passages.

It must not:

* Access another Matter.
* Access the Firm Library.
* Access private Matter Intelligence.
* Access unshared Work Product.
* Access lawyer conversations.
* Perform open-web legal research.
* Automatically send content to the lawyer.
* Present itself as a replacement for the lawyer’s advice.

A file uploaded only for a Client Assistant conversation remains temporary unless deliberately attached to a client response.

---

## 17. Current-to-Target Migration Map

| Current Feature                | Target Feature           | Upgrade Action                              |
| ------------------------------ | ------------------------ | ------------------------------------------- |
| No login gate                  | Signup and login         | Add simple email/password authentication    |
| Single default user            | Authenticated user       | Replace first-user lookup with session user |
| Single default firm            | Private user workspace   | Create one workspace per signup             |
| Workspace & Library            | Matters and Firm Library | Split                                       |
| Wide Library                   | Firm Library             | Rename and restrict                         |
| Case Projects                  | Matters                  | Move out of library                         |
| Case                           | Matter                   | Rename in UI                                |
| Create Case                    | Create Matter            | Simplify form                               |
| Case document scope            | Matter Sources           | Retain and formalize                        |
| Drafts & Documents             | Matter Work Product      | Move inside Matter                          |
| Consultation History           | History                  | Group by Matter                             |
| General Assistant              | General context          | Retain                                      |
| Case Assistant context         | Matter context           | Rename and isolate                          |
| Matter Assistant tab           | None                     | Do not build                                |
| Matter Activity                | None                     | Remove from scope                           |
| Global Activity                | History only             | Do not build                                |
| Complex Work Product lifecycle | Simple documents         | Remove                                      |
| Client Activity                | Client Assistant         | Replace                                     |
| Advanced Firm Library model    | Current document library | Defer                                       |

---

## 18. Data and Compatibility Plan

### 18.1 Existing Internal Names

During the initial upgrade:

* UI uses **Matter**.
* Database may retain `cases`.
* Foreign keys may retain `case_id`.
* Existing `/api/cases` endpoints may remain temporarily.
* Frontend Matter types may map existing Case records.

Do not perform physical table renames until the upgraded application is stable.

### 18.2 Existing Data Migration

* Existing Cases become visible as Matters.
* Existing Case documents become Matter Sources.
* Existing Case conversations become Matter conversations.
* Existing Case drafts become Work Product.
* Existing general conversations remain General Assistant conversations.
* Existing firm-level documents remain Firm Library documents.
* Existing data remains under the migrated original user account.

### 18.3 Matter Data Additions

Extend the current Matter or `cases` record with:

* Client name.
* Client email, optional.
* Status.
* Matter type or practice area.
* Jurisdiction.
* Preliminary objectives.
* Updated date.
* Last activity date.

### 18.4 Matter Intelligence Record

Add:

* Matter ID.
* Generated content.
* Source snapshot.
* Generated date.
* Last edited date.
* Internal version number.

### 18.5 Work Product Additions

Extend Drafts with:

* Updated date.
* Shared-with-client flag.
* Shared date.
* Origin.
* Parent draft ID.
* Revision type.

### 18.6 Collaboration Records

Add compact records for:

* Client access.
* Invitation token hash.
* Invitation status.
* Collaboration request.
* Client response.
* Linked request documents.

### 18.7 Ownership Enforcement

All records must be reached through the authenticated workspace.

At minimum:

* Cases or Matters filter by authenticated `firm_id`.
* Documents filter by authenticated `firm_id`.
* Firm Library requires authenticated `firm_id` and no direct Matter ownership.
* Threads filter by authenticated `user_id` and valid Matter access.
* Messages require ownership of their parent thread.
* Drafts require ownership through their Matter and thread.
* Search must filter candidates before similarity ranking.
* Delete and update operations must check ownership.
* Client Portal access must use its separate valid Matter invitation token.

---

## 19. Feature-by-Feature Implementation Sequence

Each phase must leave the application working.

### Phase 0 — Preserve the Current Baseline

* Save a complete working copy.
* Confirm current TypeScript checks.
* Confirm current production build.
* Record existing routes and database tables.
* Do not make visible feature changes.

**Complete when:** The current version can still be restored and rebuilt.

### Phase 1 — Authentication and Ownership

* Add password hashes and sessions.
* Add signup.
* Add login.
* Add logout.
* Add authenticated-session loading.
* Create a private workspace for every signup.
* Assign existing data to the original account.
* Remove first-user and first-firm database lookups.
* Add authentication middleware.
* Apply workspace ownership to all existing queries.
* Add empty states for a new account.

**Complete when:** Two signup accounts cannot see or modify each other’s data, and a new signup starts empty.

### Phase 2 — Search and Context Isolation

* Restrict Firm Library to firm-level documents.
* Restrict General Assistant to Firm Library documents.
* Restrict General History to general conversations.
* Restrict Matter searches to the selected Matter.
* Confirm no cross-Matter retrieval.
* Confirm no cross-user retrieval.

**Complete when:** Search and retrieval are isolated before the navigation is reorganized.

### Phase 3 — Navigation and Library Separation

* Update the sidebar.
* Rename Wide Library to Firm Library.
* Extract the library portion of the current Workspace screen.
* Remove Matter controls from Firm Library.
* Add the Matters global page.
* Preserve current document features.

**Complete when:** Matters and Firm Library operate as separate global sections.

### Phase 4 — Matter Core

* Build the simplified Matter card and list views.
* Add search and sorting.
* Build the simplified Create Matter form.
* Add automatic Firm Library matching.
* Add the five Matter tabs.
* Implement Overview.
* Implement Sources.

**Complete when:** A user can create an isolated Matter and manage its core information and Sources.

### Phase 5 — Assistant and History Context

* Rename Case context to Matter context.
* Add the General or Matter selector.
* Keep context clearly visible.
* Reorganize History.
* Restore the correct context when opening a conversation.
* Keep General and Matter retrieval isolated.

**Complete when:** Every conversation clearly belongs to General or one Matter.

### Phase 6 — Work Product Migration

* Move the existing Draft Editor into Matters.
* Remove global Drafts & Documents navigation.
* Migrate existing drafts.
* Require new Work Product to belong to a Matter.
* Preserve editing and DOCX export.
* Add sharing controls.
* Add linked Client Revisions.

**Complete when:** Drafting works inside Matters without introducing formal review workflows.

### Phase 7 — Matter Intelligence

* Add Generate Matter Intelligence.
* Build the five compact sections.
* Add source references.
* Add editing and saving.
* Add regeneration.
* Add Sources-changed warning.
* Store simple snapshots.

**Complete when:** Intelligence is generated only on request and remains source-backed and editable.

### Phase 8 — Collaboration

* Add client details.
* Add invite-link generation.
* Add copy and revoke.
* Add shared-document summary.
* Add lawyer requests.
* Add client responses.
* Add Collaboration unread indicator.

**Complete when:** A lawyer can invite one client, share a document, send a request, and receive a response.

### Phase 9 — Client Portal

* Add secure invitation-token access.
* Add Shared Documents.
* Add Requests.
* Add Client Revisions.
* Add the limited Client Assistant.
* Test private-information boundaries.

**Complete when:** The client sees only explicitly permitted content from one Matter.

### Phase 10 — Cleanup and Hardening

* Remove obsolete visible Case labels.
* Remove obsolete Wide Library labels.
* Remove unused global draft routes from the frontend.
* Remove unsupported or misleading controls.
* Test login and logout.
* Test direct URL access.
* Test cross-user isolation.
* Test Matter isolation.
* Test invitation revocation.
* Test client edit-copy behavior.
* Run TypeScript checks.
* Run the production build.
* Complete end-to-end smoke testing.

**Complete when:** The upgraded product is stable and existing data remains intact.

---

## 20. Google AI Studio Implementation Rules

Each Google AI Studio task must cover only one phase or one isolated feature.

Every implementation prompt should state:

* Preserve the current white, black, and grayscale UI.
* Do not redesign unrelated screens.
* Do not replace working components unnecessarily.
* Do not rename database tables destructively.
* Keep compatibility with existing records.
* Do not remove current data.
* Use secure password hashing.
* Never store plain-text passwords.
* Never trust a frontend user or Matter ID without server verification.
* Scope every query to the authenticated workspace.
* Add repeatable database migrations.
* Keep the project compiling.
* Run the TypeScript check.
* Run the production build.
* Report files changed.
* Report database changes.
* Report incomplete or simulated integrations.
* Stop after the requested feature rather than continuing into another phase.

Large files may be separated only where required for the new feature. Do not request a general architecture rewrite.

---

## 21. Deferred Features

The following are outside this compact upgrade:

* Email verification.
* Password reset.
* Social authentication.
* Multi-factor authentication.
* Team accounts.
* Multiple lawyers in one workspace.
* Roles and permissions.
* Firm administration.
* Matter Activity.
* Global Activity.
* Matter status automation.
* Deadlines.
* Responsible-lawyer workflows.
* Multiple clients per Matter.
* Work Product review and approval.
* Detailed Intelligence verification states.
* Advanced Firm Library classifications.
* Firm Library publication workflows.
* Broad notification center.
* Billing.
* Court filing.
* Docket management.
* Practice management.
* Enterprise document management.
* Automatic Matter Intelligence generation.
* Automatic regeneration after every Source change.

These features can be reconsidered after the compact system is stable and actively being tested.

---

## 22. Definition of Completion

The compact upgrade is complete when:

* A user can sign up with name, email, and password.
* A user can log in with email and password.
* A user can log out.
* Passwords are securely hashed.
* A new signup starts with an empty workspace.
* Existing data remains available to its original account.
* Users cannot access each other’s data.
* Matters and Firm Library are separate.
* Firm Library contains only firm-level documents.
* Every Matter has Overview, Intelligence, Sources, Work Product, and Collaboration.
* The Assistant supports a clear General or Matter context.
* A Matter cannot retrieve another Matter’s information.
* Work Product always belongs to a Matter.
* History is grouped by Matter and General Assistant.
* Matter Intelligence is generated only through an explicit button.
* A client sees only explicitly shared documents and requests.
* A client edit creates a separate Client Revision.
* No unnecessary Activity, approval, team, or administration system has been introduced.
* The current visual identity remains recognizable.
* The application passes its TypeScript check.
* The application passes its production build.
