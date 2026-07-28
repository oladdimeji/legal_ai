# Manual Staging Checklist

## Central configuration and health foundation

- Deploy with every new `FEATURE_*` variable set explicitly to `false`.
- Confirm existing signup, login, Matters, Firm Library, Assistant, Matter Intelligence, Work Product, collaboration, and legacy token Client Portal workflows.
- Confirm `GET /api/health`, `GET /api/health/live`, and `GET /api/health/ready` return successful non-secret status payloads.
- Inspect `GET /api/config` while signed out and confirm it contains only the seven allow-listed browser flags and no credentials, URLs, tokens, cookies, or provider details.
- Open Assistant Research sources and confirm CourtListener and GovInfo controls are absent.
- Submit a direct authenticated Assistant request containing `enableCourtListener: true` and `enableGovInfo: true`; confirm no connector citation or canned authority is returned.
- Start a staging process with each deferred flag set to `true` in isolation and confirm startup fails with a flag-name-only message that contains no secret.
- Start with unused provider credentials absent and all related flags false; confirm startup and existing workflows are unchanged.
- Review application logs and error responses for absence of document content, prompts, credentials, tokens, cookies, database URLs, and confidential client data.

Do not enable `FEATURE_GOVINFO`. Its live connector, environment-gated smoke test, and staging approval belong to the named GovInfo implementation phase.

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
