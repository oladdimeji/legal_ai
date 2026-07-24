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

The canonical variables are documented in `.env.example`. `GEMINI_API_KEY` and `SUPABASE_DB_URL` are required. Leave `LEGACY_OWNER_USER_ID`, `LEGACY_OWNER_FIRM_ID`, and `LEGACY_OWNER_INITIAL_PASSWORD` empty unless performing the existing explicit prototype-owner migration; when that migration is needed, all three must be supplied together.

## Troubleshooting

- Missing Gemini key: set `GEMINI_API_KEY` in `.env` and restart.
- Missing or inaccessible database: verify `SUPABASE_DB_URL`, network access, TLS requirements, and database credentials.
- pgvector permission failure: have the database administrator enable pgvector or grant the deployment user permission to run `CREATE EXTENSION IF NOT EXISTS vector`.
- Startup migration failure: stop the rollout, inspect the server log, verify database permissions and connectivity, and restore from the pre-update backup if required. Do not edit migration history manually.
- Development mode in production: use `npm start` or the provided container. Do not run `node dist/server.cjs` directly without explicitly setting `NODE_ENV=production`.
