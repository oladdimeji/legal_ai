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

Do not run `npm run dev` behind a full-tunnel client VPN. The local Node process uses Gemini, Supabase, and Brevo on the same machine; a tunnel on that path is what makes ordinary requests stall. Use split tunneling (see below) or turn the VPN off while developing.

```bash
npm run dev
```

The default address is `http://localhost:3000`.

## Verification and production startup

```bash
npm run lint
npm test
npm run build
npm run verify
npm start
```

`npm run verify` runs the type/lint check, automated tests, and production build. `npm start` serves the already-built application and forces `NODE_ENV=production` even when it was not exported by the operator.

At startup, Exepts connects to the external database, acquires the existing migration advisory lock, and applies any pending repository migrations before serving routes. Startup does not seed demo data unless `SEED_DEMO_DATA=true`; keep it false in normal and production environments. The health endpoint is `GET /api/health`.

## Docker Compose deployment

Docker Compose is the canonical production deployment path.

```bash
cp .env.example .env
# Fill in the required values and keep SEED_DEMO_DATA=false.
docker compose build
docker compose up -d
docker compose ps
```

The Compose service builds a deterministic multi-stage Node 22 image, loads `.env`, publishes `PORT` (default `3000`), and checks `/api/health`. It does not include a database; use the external Supabase/PostgreSQL service. Do not place the production host on a client VPN; the container already publishes only on `127.0.0.1`.

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

The canonical variables are documented in `.env.example`. `GEMINI_API_KEY` and `SUPABASE_DB_URL` are required. Leave `LEGACY_OWNER_USER_ID`, `LEGACY_OWNER_FIRM_ID`, and `LEGACY_OWNER_INITIAL_PASSWORD` empty unless performing the existing explicit prototype-owner migration; when that migration is needed, all three must be supplied together.

## Private-preview site lock

The site lock is enabled by default and is disabled only when `SITE_LOCKED=false` is set explicitly. While locked, anonymous and non-approved users see the coming-soon screen and cannot create or restore an application session or use protected APIs. The allowlist is read only by the server and email matching is case-insensitive after surrounding whitespace is removed. The countdown date controls presentation only: reaching zero does not unlock the application.

The following values are examples, not built-in accounts or deployment defaults:

```env
SITE_LOCKED=true
SITE_REOPENS_AT=2026-08-15T09:00:00Z
SITE_ALLOWED_EMAILS=oladimeji@workpodd.com,themamatra01@gmail.com, rasheedmuhammed002@gmail.com
```

To configure private preview:

1. Keep `SITE_LOCKED=true` or leave it unset.
2. Set `SITE_REOPENS_AT` to the intended ISO-8601 countdown date, or leave it empty for a generic launching-soon state.
3. Set `SITE_ALLOWED_EMAILS` to the comma-separated approved email addresses.
4. Rebuild and restart the application using the normal deployment process.

An unset, empty, or malformed allowlist fails closed while the lock is enabled. To reverse the change, set `SITE_LOCKED=false` explicitly, then rebuild and restart the application. No database rollback, account change, or session reset is required.

## VPN and split tunneling

Exepts does not proxy Gemini Live through the application server. Voice still opens a browser WebSocket to Google; typed chat, drafts, lookup, and stored clips already go browser to Exepts, then Exepts to Gemini and Supabase. That is the path that already works without a VPN. A full-tunnel VPN sits on those sockets; the application is not changed to compensate.

Keep VPN and non-VPN on that same path by split-tunneling (excluding) at least:

- the public application host (`exepts.com`, or the host in `APP_URL`)
- `generativelanguage.googleapis.com` (Voice Live, and local Node Gemini calls)
- for Google sign-in and Drive: `accounts.google.com`, `apis.google.com`, `www.googleapis.com`

For local `npm run dev`, also exclude the Postgres/Supabase host from `SUPABASE_DB_URL` and `api.brevo.com`, or disable the VPN while the server is running.

## Troubleshooting

- Missing Gemini key: set `GEMINI_API_KEY` in `.env` and restart.
- Missing or inaccessible database: verify `SUPABASE_DB_URL`, network access, TLS requirements, and database credentials.
- pgvector permission failure: have the database administrator enable pgvector or grant the deployment user permission to run `CREATE EXTENSION IF NOT EXISTS vector`.
- Startup migration failure: stop the rollout, inspect the server log, verify database permissions and connectivity, and restore from the pre-update backup if required. Do not edit migration history manually.
- Development mode in production: use `npm start` or the provided container. Do not run `node dist/server.cjs` directly without explicitly setting `NODE_ENV=production`.
- Voice transcription, spoken replies, or Live disconnects only while a VPN is on: split-tunnel the hosts in **VPN and split tunneling**. Do not add a Live proxy.
- Local typed chat or drafts stall only while a VPN is on: the Node process is tunneled; exclude Gemini and the database host, or turn the VPN off for development.
