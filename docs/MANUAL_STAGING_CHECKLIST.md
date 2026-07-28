# Manual Staging Checklist

## Central configuration and health foundation

- Deploy with every new `FEATURE_*` variable set explicitly to `false`.
- Confirm existing signup, login, Matters, Firm Library, Assistant, Matter Intelligence, Work Product, collaboration, and legacy token Client Portal workflows.
- Confirm `GET /api/health`, `GET /api/health/live`, and `GET /api/health/ready` return successful non-secret status payloads.
- Inspect `GET /api/config` while signed out and confirm it contains only the six allow-listed browser flags and no credentials, URLs, tokens, cookies, or provider details.
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
