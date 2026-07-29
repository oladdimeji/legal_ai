# Web-Only Release Checklist

This checklist describes the current Exepts release. The application has one web service and no manual product feature switches.

1. Back up the database and confirm migrations are additive. Do not reset, truncate, rename, or reseed existing data.
2. Set `APP_BASE_URL`, `GEMINI_API_KEY`, and `SUPABASE_DB_URL`. Keep `SEED_DEMO_DATA=false`.
3. Leave each optional integration entirely empty or supply its complete credential set from `.env.example`.
4. Run `npm ci`, `npm run lint`, `npm test`, `npm run build`, and `npm run verify`.
5. Run `docker compose config --services` and confirm the only output is `web`.
6. Run `docker compose build` and confirm the image starts with `/api/health/ready` returning database readiness.
7. Verify signup/login/logout, firm invitations and teams, client invitations/dashboard/notifications, Matter isolation, synchronous PDF/DOCX/TXT upload, lifecycle actions, Work Product availability after conversation deletion, and legacy Client Portal access.
8. When Google is configured, verify linked sign-in, link/status/refresh/disconnect/revocation, and Drive export with no Gmail scope.
9. When GovInfo is configured, verify official retrieval and safe outage behavior.
10. When Brevo is configured, verify delivery metadata without message bodies. When it is absent, verify only authorized invitation creators receive the one-time invitation URL and reset/verification tokens remain secret.
