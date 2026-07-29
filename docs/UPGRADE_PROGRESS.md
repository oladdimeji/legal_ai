# Upgrade Progress

## Web-Only Ungated Product Cleanup — complete

Exepts now builds and deploys as a single React/Express web application. Core completed functionality is unconditional. Optional GovInfo, Google account/Drive-export, and Brevo integrations activate from complete credential sets and expose only safe status through `/api/config`.

Removed from the current release:

- Separate background processing service and queue topology
- Malware-scanning topology
- Private/resumable uploads and background document processing
- Google Drive import and Picker surfaces
- CourtListener placeholder, Gmail sending, and OCR placeholders
- Queue status, cancellation, retry, and background visibility APIs
- Delayed permanent-deletion routes that had no web-only processor
- Manual environment-controlled product switches and browser feature payloads

Preserved:

- React, Express, PostgreSQL/Supabase, and Gemini architecture
- Existing workspace, Matter, client, and firm authorization boundaries
- Existing synchronous PDF, DOCX, and TXT upload/extraction
- Google account linking/sign-in/connection management and Drive export
- GovInfo and Brevo completed provider integrations
- All historical migrations and existing additive database columns/tables, including inactive background-processing, private-original, Drive-import, and deletion-request records
- Existing user data, audit history, and Work Product independence from conversation deletion

No destructive schema migration was added. Current verification commands and results are recorded in the phase commit and final implementation report.
