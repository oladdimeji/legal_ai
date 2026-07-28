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

