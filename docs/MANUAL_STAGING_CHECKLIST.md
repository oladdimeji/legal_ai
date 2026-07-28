# Manual Staging Checklist

## Google account linking, sign-in, and Drive

- Back up the staging database and deploy migration 016 with `FEATURE_GOOGLE_DRIVE=false`; confirm existing password signup/login, Matters, Firm Library, Assistant, Matter Intelligence, Work Product, collaboration, and the legacy token Client Portal are unchanged.
- Complete the private-storage and async-ingestion checklists first. Google activation requires `FEATURE_PRIVATE_STORAGE=true`, `FEATURE_ASYNC_INGESTION=true`, the web process, worker, private bucket, and ClamAV to be healthy.
- Create separate Google OAuth clients for local, staging, and production. Set `GOOGLE_OAUTH_REDIRECT_URI` to the exact deployed `/api/auth/google/callback` URL and register that exact URI in Google Cloud.
- Restrict `GOOGLE_PICKER_API_KEY` to the staging web origin and Google Picker API. Set `GOOGLE_CLOUD_PROJECT_NUMBER` to the numeric project number and confirm neither the client secret nor refresh tokens appear in the browser bundle, `/api/config`, logs, or errors.
- Inspect the Google consent request and confirm its complete scope list is exactly `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/drive.file`. Confirm no Gmail scope or Gmail control exists and `FEATURE_GMAIL_SEND=false`.
- Provide a dedicated staging refresh token/file and run `GOOGLE_DRIVE_LIVE_SMOKE=true npm test`. Remove the smoke token from the test environment after the run.
- Enable `FEATURE_GOOGLE_DRIVE=true` in staging. Link a Google account from Settings and confirm the connection email/status appears while password login continues to work.
- Attempt to link a Google subject already connected to another Exepts user and a different subject to an already linked user. Confirm both are rejected without email-based merging or ownership disclosure.
- Test expired, replayed, missing, altered, cross-browser, and provider-cancelled OAuth state; test an altered callback URI. Confirm each fails safely and creates no connection or session.
- Log out and sign in with the linked Google account. Then try an unlinked Google account whose email matches an Exepts password account; confirm it is not merged and is instructed to link after password login.
- In Firm Library and in two different Matters, select supported PDF, DOCX, TXT, and Google Doc fixtures. Confirm each original/export is private, has a firm/Matter/document/version path, and is queued only after storage succeeds.
- Confirm Google Docs are exported to DOCX before private storage. Confirm unsupported formats, empty files, files over 50 MB, duplicate content, storage failure, revoked access, and worker failure produce safe bounded states without file bytes or extracted text in logs.
- Inspect `drive_file_imports` and `document_versions`; confirm Drive file ID, canonical link, modified/import times, imported/current parent IDs, revision/checksum where available, stored SHA-256, sync state, and private version identity are retained.
- Modify, move, trash, and restrict permissions on fixtures, then use Refresh status. Confirm `changed`, `moved`, `moved and changed`, `deleted`, `permission restricted`, or honest `unavailable` states. Re-import a changed fixture and confirm a new document version is processed without replacing another Matter's data.
- Attempt list, refresh, and re-import with another user, firm, Matter, import ID, file ID, document ID, and connection ID. Confirm no metadata, canonical link, state, filename, object key, or content is disclosed.
- Export representative Work Product and Matter Intelligence to Drive. Confirm each DOCX opens from the returned canonical Drive link and `drive_exports` records the authenticated firm, user, Matter, source identity, Drive identity, and export time.
- Disconnect Google. Confirm provider revocation is attempted, the encrypted refresh token is cleared locally, tracked files show connection revoked, imported Exepts copies remain available, and password login still works. If provider revocation cannot be confirmed, verify the UI instructs the user to review Google Account access.
- Review database rows, logs, API errors, observability, and browser storage for absence of plaintext refresh tokens, authorization codes, PKCE verifiers, access tokens at rest, document bytes, extracted text, prompts, cookies, database URLs, and client secrets.

Keep `FEATURE_GOOGLE_DRIVE=false` until every Google staging item passes. Keep `FEATURE_GMAIL_SEND=false`; Gmail sending and Gmail scopes are deferred.

## Central configuration and health foundation

- Deploy with every new `FEATURE_*` variable set explicitly to `false`.
- Confirm existing signup, login, Matters, Firm Library, Assistant, Matter Intelligence, Work Product, collaboration, and legacy token Client Portal workflows.
- Confirm `GET /api/health`, `GET /api/health/live`, and `GET /api/health/ready` return successful non-secret status payloads.
- Inspect `GET /api/config` while signed out and confirm it contains only the seven allow-listed browser flags and no credentials, URLs, tokens, cookies, or provider details.
- Open Assistant Research sources and confirm CourtListener controls are absent while GovInfo remains absent with its flag false.
- Submit a direct authenticated Assistant request containing `enableCourtListener: true`; confirm no CourtListener citation or canned authority is returned.
- Start a staging process with each deferred flag set to `true` in isolation and confirm startup fails with a flag-name-only message that contains no secret.
- Start with unused provider credentials absent and all related flags false; confirm startup and existing workflows are unchanged.
- Review application logs and error responses for absence of document content, prompts, credentials, tokens, cookies, database URLs, and confidential client data.

## Live GovInfo retrieval

- Back up the staging database and keep `FEATURE_GOVINFO=false` for the first deployment so migration 015 can be reviewed.
- Set `GOVINFO_API_KEY` and `GOVINFO_BASE_URL=https://api.govinfo.gov`; confirm neither appears in `/api/config`, logs, errors, or browser bundles.
- Run `GOVINFO_LIVE_SMOKE=true npm test` in the staging test process and confirm the live smoke test retrieves a canonical GovInfo source with material text.
- Enable `FEATURE_GOVINFO=true` in staging. Confirm the GovInfo control appears and CourtListener remains absent.
- Confirm every displayed GovInfo citation shows provider, publication date when available, retrieval date, canonical link, metadata, and an exact stored passage.
- Inspect `research_runs`, `research_run_sources`, and `retrieved_legal_sources`; confirm each run is scoped to the authenticated firm, user, thread, and optional Matter.
- Attempt cross-firm, cross-user, cross-thread, and cross-Matter access and confirm no metadata or passage is returned.
- Simulate timeout, 429, 503, malformed response, missing content, and outage. Confirm bounded retries and no invented authority; the UI explicitly reports provider unavailability.
- Attempt to update or delete run/source rows and confirm immutable-trace triggers reject the mutation.

Keep `FEATURE_GOVINFO=false` until every GovInfo staging item passes. Keep `FEATURE_COURTLISTENER=false`; CourtListener is deferred and hidden.

## Public, lawyer, and client routing shell

- Keep `FEATURE_CLIENT_ACCOUNTS=false`; confirm reserved client-account routes show no active account controls.
- While signed out, open `/`, `/login`, and `/signup` directly; then confirm `/app` and every nested lawyer route redirects to `/login`.
- Sign in and refresh `/app`, `/app/matters`, `/app/library`, `/app/history`, `/app/settings`, and `/app/matters/<owned-id>` in production serving mode.
- Confirm a foreign or invalid Matter identifier returns no Matter information.
- Exercise Assistant General/Matter context, Matters, Firm Library, Matter Intelligence, Work Product, collaboration, History, Settings, and logout.
- Open an active legacy `/client/:token` link and verify shared Work Product, requests, responses, revisions, and Client Assistant.
- Open `/client/invitations/<test-token>` and confirm it is not interpreted as a legacy portal token.
- Test keyboard navigation at narrow and wide viewports: skip links, focus, landmarks, active navigation, loading announcements, and error alerts.
- Confirm the reverse proxy forwards nested application paths to Exepts instead of returning a proxy 404.

Do not enable `FEATURE_CLIENT_ACCOUNTS` until the client-account migration phase and its staging gate are complete.

## Private originals and resumable upload

- Create or verify `STORAGE_BUCKET` as private; do not add a public read policy.
- Set `OBJECT_STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, and the server-only `SUPABASE_SECRET_KEY`; confirm `/api/config` exposes none of them.
- Keep `FEATURE_PRIVATE_STORAGE=false`, deploy, and confirm all existing multipart document and Client Portal routes still work.
- Back up the database, enable `FEATURE_PRIVATE_STORAGE=true` in staging, and restart so migration 013 applies.
- Upload 20 mixed PDF/DOCX/TXT files, including a file near 50 MB. Confirm browser traffic sends TUS chunks to Supabase Storage and no complete file body to Express.
- Interrupt and resume a large upload; confirm the same version is confirmed once.
- Confirm object paths contain the authenticated firm, Matter or Firm Library resource, document ID, version ID, and safe filename.
- Attempt authorization, confirmation, and download with foreign Matter, firm, user, and version IDs; confirm no metadata, object path, or signed URL is disclosed.
- Exercise per-file, file-count, batch-byte, workspace-file, workspace-byte, duplicate-checksum, expired-authorization, missing-object, wrong-size, and wrong-checksum failures.
- Confirm completed uploads and version metadata survive a restart.
- Confirm an authorized original download is private and short-lived, and cross-firm access is denied.
- Review logs and errors for absence of document content, checksums, authorization tokens, credentials, cookies, and database URLs.

Keep `FEATURE_PRIVATE_STORAGE=false` until every staging item above passes. The worker and extraction/indexing transition from `Uploaded` are intentionally deferred.

## Async ingestion worker and malware scanning

- Keep `FEATURE_ASYNC_INGESTION=false` until the private-storage checklist and every item below pass.
- Set `JOBS_PROVIDER=pg-boss`, `MALWARE_SCANNER_PROVIDER=clamav`, `CLAMAV_HOST=clamav`, and `CLAMAV_PORT=3310`.
- Run `docker compose up -d`; confirm `web`, `worker`, and `clamav` are healthy and port 3310 is not published to the host.
- Upload clean PDF, DOCX, and TXT fixtures. Confirm durable transitions through uploaded, scanning, extracting, indexing, and ready after navigation and restart.
- Upload the EICAR test fixture in an isolated staging workspace. Confirm extraction never starts, the state becomes failed, and no extracted text, chunk, or embedding is stored.
- Upload an image-only PDF. Confirm its original remains downloadable and its terminal state is `needs_ocr`; confirm no OCR control or credential is requested.
- Upload a mixed batch with one corrupt and two valid files. Confirm the valid files reach ready independently and the corrupt file has bounded retries plus failed visibility.
- Stop the worker during scanning/indexing, wait past the stale threshold, restart it, and confirm recovery does not duplicate chunk indexes or embeddings.
- Cancel queued and active fixtures; confirm durable cancelled visibility and no later transition to ready.
- Attempt status and cancellation requests from another firm and another Matter; confirm no version, filename, state, job ID, or error detail is disclosed.
- Review web, worker, pg-boss, and ClamAV logs for absence of file bytes, extracted text, prompts, credentials, tokens, checksums, cookies, database URLs, and client data.

Keep `FEATURE_ASYNC_INGESTION=false` until this checklist passes.
