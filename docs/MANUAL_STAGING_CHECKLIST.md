# Manual Staging Checklist

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
