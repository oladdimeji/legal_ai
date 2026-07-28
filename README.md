# Exepts

Exepts is a private, Matter-centered legal workspace with AI-assisted research, document understanding, Work Product, and client collaboration.

## Architecture and prerequisites

- React and Vite frontend
- Express on Node.js 22
- External Supabase/PostgreSQL database with pgvector
- Gemini API

Use Node.js 22 and npm 10. A Gemini API key and a reachable PostgreSQL/Supabase connection URL are required. The database user must be allowed to enable or use pgvector and apply the repository's migrations.

## Local development

```bash
npm ci
cp .env.example .env
```

Fill in `GEMINI_API_KEY` and `SUPABASE_DB_URL`, set `NODE_ENV=development`, and keep `SEED_DEMO_DATA=false`. The server loads `.env` from the project directory through `dotenv`.

```bash
npm run dev
```

The default address is `http://localhost:3000`.

## Application routes

- `/` is the public Exepts landing page; `/login` and `/signup` are dedicated authentication routes.
- `/app` is the authenticated lawyer workspace. Its core surfaces and individual Matters have nested browser routes that support direct refresh after authentication.
- `/join/:token` is the default-hidden firm-member invitation acceptance route behind `FEATURE_FIRM_TEAMS`.
- `/client/login`, `/client/dashboard`, and `/client/invitations/:token` reserve the client-account route family behind `FEATURE_CLIENT_ACCOUNTS`.
- `/client/:token` remains the active legacy token Client Portal until the client-account migration is completed.

Production serving returns the built `index.html` for non-API route refreshes. Reverse proxies must forward these application paths to Exepts rather than returning their own 404 page.

## Verification and production startup

```bash
npm run lint
npm test
npm run build
npm run verify
npm start
```

`npm run verify` runs the type/lint check, automated tests, and production build. `npm start` serves the already-built application and forces `NODE_ENV=production` even when it was not exported by the operator.

At startup, Exepts validates centralized server configuration, connects to the external database, acquires the existing migration advisory lock, and applies any pending repository migrations before serving routes. Startup does not seed demo data unless `SEED_DEMO_DATA=true`; keep it false in normal and production environments.

Health endpoints:

- `GET /api/health/live` is the liveness foundation.
- `GET /api/health/ready` reports readiness with non-secret check names and states.
- `GET /api/health` remains as the backward-compatible deployment health endpoint.
- `GET /api/config` returns only an explicit allow-list of browser-safe feature flags.

## Docker Compose deployment

Docker Compose is the canonical production deployment path. The Manager Preview
defaults to the web-only topology: worker and ClamAV are retained behind the
opt-in `ingestion` profile and are not started by the default command.

```bash
cp .env.example .env
# Fill in the required values and keep SEED_DEMO_DATA=false and
# FEATURE_ASYNC_INGESTION=false.
docker compose build
docker compose up -d
docker compose ps
```

The default command starts only `web`, publishes `PORT` (default `3000`), and
checks `/api/health/ready`. It does not include a database; use the external
Supabase/PostgreSQL service.

The deferred ingestion topology remains available for a later staged release:

```bash
# Only after private storage, pg-boss, and ClamAV have passed staging.
docker compose --profile ingestion up -d
```

That opt-in profile starts `web`, `worker`, and private `clamav`. Do not use it
for Manager Preview, where `FEATURE_ASYNC_INGESTION=false`.

Before every production update, take and verify a database backup. Retain the previously deployed image or release, fetch the intended source revision, review `.env`, run `npm ci` and `npm run verify`, build the new image, then run `docker compose up -d`. Confirm the health check and review `docker compose logs app`. If validation fails, redeploy the retained release and investigate before retrying.

## Manual Linux/Node deployment

As a secondary path, install Node.js 22 and npm 10, check out the intended release, create `.env`, then run:

```bash
npm ci
npm run verify
npm start
```

Run `npm start` under a service manager. Place a reverse proxy in front of the application, terminate HTTPS there, forward traffic to the configured local `PORT`, and configure DNS for the public hostname.

## Environment

The canonical variables are documented in `.env.example`. `GEMINI_API_KEY` and `SUPABASE_DB_URL` are required by existing model and database workflows. Leave `LEGACY_OWNER_USER_ID`, `LEGACY_OWNER_FIRM_ID`, and `LEGACY_OWNER_INITIAL_PASSWORD` empty unless performing the existing explicit prototype-owner migration; when that migration is needed, all three must be supplied together.

Every new feature flag defaults to `false`. Provider-specific configuration is validated only when its corresponding feature is enabled. `FEATURE_CLIENT_ACCOUNTS=false` keeps reserved client-account routes inactive while legacy token links continue working. GovInfo is the only live V1 legal-source connector: staging requires `GOVINFO_API_KEY`, the official `GOVINFO_BASE_URL`, and `FEATURE_GOVINFO=true`. Keep `FEATURE_GOVINFO=false` until its staging checklist passes. `FEATURE_COURTLISTENER`, `FEATURE_GMAIL_SEND`, and `FEATURE_OCR` remain false and unavailable.

Firm membership and Matter-assignment authorization is enforced centrally for authenticated APIs. Existing users are migrated to active `firm_admin` memberships and retain existing Matter access. New Matter creators are assigned automatically. `firm_admin` has firm-wide access; `lawyer`, `staff`, and `read_only` access is restricted to assigned Matters with progressively narrower write/delete/client/team/integration permissions. Suspended and removed memberships cannot create sessions or use existing sessions. Keep `FEATURE_FIRM_TEAMS=false` until migration 017 and the role/assignment staging matrix pass; the flag controls invitation and team-management UI/APIs, not the underlying authorization boundary.

Google capabilities use independent server gates. `FEATURE_GOOGLE_ACCOUNT`
enables linking, linked-only sign-in, status/refresh, disconnect, and revocation.
`FEATURE_GOOGLE_DRIVE_EXPORT` enables Work Product and Matter Intelligence
exports and requires the account gate, but does not require private storage,
pg-boss, worker, or ClamAV. `FEATURE_GOOGLE_DRIVE_IMPORT` is the only gate for
Picker/import/refresh/re-import and remains false for Manager Preview; if staged
later, it still requires the existing private-storage and async-ingestion
topology. The legacy `FEATURE_GOOGLE_DRIVE=true` value remains compatible by
enabling Account and Export only; it never enables Import.

Configure an exact environment-specific OAuth callback and a canonical
`APP_ENCRYPTION_KEY_BASE64`. Picker API key and project values are required only
for Drive import. The server requests exactly `openid`, `email`, `profile`, and
`https://www.googleapis.com/auth/drive.file`; it never merges accounts based on
email, never removes password login, and never requests or sends Gmail.

Link Google from Settings before using the login-page Google option. Drive Picker is available in Firm Library and Matter Sources. Imported records retain Drive identity, link, modification/revision/checksum metadata, private-version identity, and lifecycle state. Work Product and Matter Intelligence export as DOCX files through `drive.file`. Run the environment-gated staging smoke with `GOOGLE_DRIVE_LIVE_SMOKE=true npm test` only after providing a dedicated `GOOGLE_DRIVE_SMOKE_REFRESH_TOKEN` and `GOOGLE_DRIVE_SMOKE_FILE_ID`; these are excluded from normal CI.

GovInfo retrieval uses official search, package, and granule endpoints with bounded retries, timeouts, pagination, and a short server cache. Each request writes an immutable firm/user/thread-scoped research run and exact supporting passages before those sources may be cited. Run the environment-gated staging smoke test with `GOVINFO_LIVE_SMOKE=true npm test`; it is skipped in normal CI.

Private originals are gated by `FEATURE_PRIVATE_STORAGE=false`. Staging activation requires `OBJECT_STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, the server-only `SUPABASE_SECRET_KEY`, and a private `STORAGE_BUCKET`. The server creates narrow two-hour signed upload tokens; browsers send 6 MB resumable TUS chunks directly to Supabase Storage. The service key is never returned by an API or included in Vite code.

Uploads are limited to 50 MB per file, 25 files and 500 MB per batch, and 10,000 files or 10 GB per workspace. Existing multipart PDF/DOCX/TXT routes remain available while the private-storage and async-ingestion flags are false.

Async ingestion is independently gated by `FEATURE_ASYNC_INGESTION=false`. When enabled after staging, set `JOBS_PROVIDER=pg-boss`, `MALWARE_SCANNER_PROVIDER=clamav`, `CLAMAV_HOST=clamav`, and `CLAMAV_PORT=3310`, enable private storage, and start Compose with `--profile ingestion`. Only confirmed objects are queued. The worker scans before extraction, then extracts PDF/DOCX/TXT, chunks, embeds, and durably records progress. Image-only PDFs remain stored and enter `needs_ocr`; OCR is deferred in V1.

Resource lifecycle controls are gated by `FEATURE_RESOURCE_LIFECYCLE=false` and require staged async ingestion. The phase adds Matter archive/restore, retention and export packages; Source replacement, metadata, versions, original download, re-index, archive, dependency warnings and protected deletion; Firm Library folders, tags and bulk lifecycle actions; and Work Product autosave, immutable lawyer/client version lanes, restore-as-new-version, DOCX/PDF export, archive and intentional add-as-Matter-Source. Permanent deletion is administrator-only, requires archive state and exact typed confirmation, respects retention and blocking dependencies, waits at least 24 hours, removes private originals before database content, and leaves an audit trail. Keep the flag false until its staging checklist passes.

Operators can inspect firm-scoped processing visibility at `GET /api/ingestion/jobs` and request cancellation with `POST /api/ingestion/:versionId/cancel`. Failed work is retained by pg-boss for 30 days and exposes only safe error codes through the application API.

See [the manual staging checklist](docs/MANUAL_STAGING_CHECKLIST.md) before changing any flag.

## Troubleshooting

- Missing Gemini key: set `GEMINI_API_KEY` in `.env` and restart.
- Missing or inaccessible database: verify `SUPABASE_DB_URL`, network access, TLS requirements, and database credentials.
- pgvector permission failure: have the database administrator enable pgvector or grant the deployment user permission to run `CREATE EXTENSION IF NOT EXISTS vector`.
- Startup migration failure: stop the rollout, inspect the server log, verify database permissions and connectivity, and restore from the pre-update backup if required. Do not edit migration history manually.
- Development mode in production: use `npm start` or the provided container. Do not run `node dist/server.cjs` directly without explicitly setting `NODE_ENV=production`.
