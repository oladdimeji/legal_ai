# Exepts

Exepts is a web-only legal workspace built with React, Express, PostgreSQL/Supabase, and Gemini. The production deployment contains one `web` service. Database migrations are additive and run at startup; startup never resets existing data and demo seeding requires the explicit `SEED_DEMO_DATA=true` safety opt-in.

## Run locally

Use Node.js 22 and npm 10.

```bash
copy .env.example .env
npm ci
npm run dev
```

Production:

```bash
npm run build
npm start
```

Required production configuration is `APP_BASE_URL`, `GEMINI_API_KEY`, and `SUPABASE_DB_URL`. `PORT` defaults to `3000`. See `.env.example` for the explicit legacy-owner migration and optional integrations.

## Current Feature Inventory

### Available core functionality

- Public landing page and password signup, login, and logout
- Authenticated Matter workspaces with workspace- and Matter-scoped authorization
- Firm Library, Assistant, History, Matter Intelligence, and Work Product
- Matter Sources with synchronous PDF, DOCX, and TXT extraction
- Collaboration and the existing legacy token Client Portal
- Firm memberships, invitations, teams, roles, and Matter assignments
- Client accounts, dashboard, notifications, and account security
- Archive, restore, retention, tags, folder paths, versions, DOCX/PDF export, and Add Work Product as Source

Core functionality is unconditional. Exepts does not use manual product feature switches.

### Optional configured integrations

- GovInfo activates when `GOVINFO_API_KEY` is present. `GOVINFO_BASE_URL` may override the official API origin.
- Google account linking, linked sign-in, connection management, revocation, and Drive export activate when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, and a canonical 32-byte `APP_ENCRYPTION_KEY_BASE64` are all present.
- Brevo transactional email activates when `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_API_BASE_URL`, and `APP_BASE_URL` are all present. Without Brevo, an authorized lawyer creating a client or team invitation receives its one-time copyable invitation URL. Verification and password-reset tokens are never returned.

Partial optional-provider configuration fails startup with the missing variable names. `/api/config` returns only non-secret integration status and capabilities.

### Not included in this release

CourtListener, Gmail sending, OCR, Google Drive import, private/resumable uploads, background ingestion, queue monitoring, background retry/cancellation, malware scanning, and delayed permanent deletion are not part of this release. Historical additive schema and migration records are retained so existing data is preserved.

## Deployment and verification

Create `.env` from `.env.example`, then:

```bash
npm ci
npm run lint
npm test
npm run build
npm run verify
docker compose config --services
docker compose build
```

`docker compose config --services` must print only `web`. The production build emits `dist/server.cjs` and frontend assets.

## Security boundaries

Every authenticated database access remains scoped to the current firm/workspace. Matter context cannot retrieve another Matter, and general context cannot retrieve Matter data. Client access is separately scoped. Provider secrets remain server-side, OAuth state is bound and one-time, invitation/reset/verification tokens are hash-stored with expiry, and no fallback user is selected after authentication.
