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

Docker Compose is the canonical production deployment path.

```bash
cp .env.example .env
# Fill in the required values and keep SEED_DEMO_DATA=false.
docker compose build
docker compose up -d
docker compose ps
```

The Compose service builds a deterministic multi-stage Node 22 image, loads `.env`, publishes `PORT` (default `3000`), and checks `/api/health`. It does not include a database; use the external Supabase/PostgreSQL service.

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

Every new feature flag defaults to `false`. Provider-specific configuration is validated only when its corresponding feature is enabled. `FEATURE_CLIENT_ACCOUNTS=false` keeps reserved client-account routes inactive while legacy token links continue working. GovInfo is the only live V1 legal-source connector: staging requires `GOVINFO_API_KEY`, the official `GOVINFO_BASE_URL`, and `FEATURE_GOVINFO=true`. Keep `FEATURE_GOVINFO=false` until its staging checklist passes. `FEATURE_COURTLISTENER`, `FEATURE_GMAIL_SEND`, and `FEATURE_OCR` remain false and unavailable. Google Drive uses its own `FEATURE_GOOGLE_DRIVE` flag and, when implemented and enabled in its named phase, requires server-side OAuth settings plus `APP_ENCRYPTION_KEY_BASE64`; no Gmail scope is requested.

GovInfo retrieval uses official search, package, and granule endpoints with bounded retries, timeouts, pagination, and a short server cache. Each request writes an immutable firm/user/thread-scoped research run and exact supporting passages before those sources may be cited. Run the environment-gated staging smoke test with `GOVINFO_LIVE_SMOKE=true npm test`; it is skipped in normal CI.

Private originals are gated by `FEATURE_PRIVATE_STORAGE=false`. Staging activation requires `OBJECT_STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, the server-only `SUPABASE_SECRET_KEY`, and a private `STORAGE_BUCKET`. The server creates narrow two-hour signed upload tokens; browsers send 6 MB resumable TUS chunks directly to Supabase Storage. The service key is never returned by an API or included in Vite code.

Uploads are limited to 50 MB per file, 25 files and 500 MB per batch, and 10,000 files or 10 GB per workspace. Existing multipart PDF/DOCX/TXT routes remain available while the private-storage and async-ingestion flags are false.

Async ingestion is independently gated by `FEATURE_ASYNC_INGESTION=false`. When enabled after staging, set `JOBS_PROVIDER=pg-boss`, `MALWARE_SCANNER_PROVIDER=clamav`, `CLAMAV_HOST=clamav`, and `CLAMAV_PORT=3310`, and enable private storage. Compose runs separate `web`, `worker`, and private `clamav` services. Only confirmed objects are queued. The worker scans before extraction, then extracts PDF/DOCX/TXT, chunks, embeds, and durably records progress. Image-only PDFs remain stored and enter `needs_ocr`; OCR is deferred in V1.

Operators can inspect firm-scoped processing visibility at `GET /api/ingestion/jobs` and request cancellation with `POST /api/ingestion/:versionId/cancel`. Failed work is retained by pg-boss for 30 days and exposes only safe error codes through the application API.

See [the manual staging checklist](docs/MANUAL_STAGING_CHECKLIST.md) before changing any flag.

## Troubleshooting

- Missing Gemini key: set `GEMINI_API_KEY` in `.env` and restart.
- Missing or inaccessible database: verify `SUPABASE_DB_URL`, network access, TLS requirements, and database credentials.
- pgvector permission failure: have the database administrator enable pgvector or grant the deployment user permission to run `CREATE EXTENSION IF NOT EXISTS vector`.
- Startup migration failure: stop the rollout, inspect the server log, verify database permissions and connectivity, and restore from the pre-update backup if required. Do not edit migration history manually.
- Development mode in production: use `npm start` or the provided container. Do not run `node dist/server.cjs` directly without explicitly setting `NODE_ENV=production`.
