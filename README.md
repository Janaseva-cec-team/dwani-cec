# Dhwani — Civic Issue Reporting & Tracking

Dhwani is a civic grievance reporting and tracking application focused on the Mangaluru City Corporation area.

## Primary application

The primary application in this repository is the vanilla HTML/CSS/JavaScript frontend served by the Express backend.

### Requirements
- Node.js 20 or later
- npm

### Run locally (Windows PowerShell)
```powershell
cd server
npm install
Copy-Item .env.example .env
npm start
```

Open http://localhost:3000.

### Run locally (macOS/Linux)
```bash
cd server
npm install
cp .env.example .env
npm start
```

## Demo accounts (local development only)

The bundled demo data may include:
- Admin: `admin@dhwani.org` / `admin123`
- Officer: `officer.pwd@dhwani.org` / `pwd123`
- Citizen: `citizen@example.com` / `citizen123`

These are demonstration credentials, not production credentials. In `NODE_ENV=production`, built-in demo accounts are removed automatically unless `DHWANI_KEEP_DEMO_ACCOUNTS=true` is explicitly set. Never enable that override on a public deployment.

To grant admin access to a real account, first register it, then run locally from `server`:
```bash
node scripts/promote-admin.js your-account@example.com
```
Restart the server after promotion.

## Production checklist

1. Set `NODE_ENV=production`.
2. Set `CORS_ORIGIN` to the exact deployed frontend origin(s), comma-separated.
3. Use persistent storage and back up `server/data.json` and `server/uploads/`.
4. Use HTTPS at the hosting platform/reverse proxy.
5. Set strong unique passwords; remove all demo accounts.
6. Configure monitoring, log retention, and an external rate-limit store if deploying multiple instances.
7. Move uploaded media to private object storage and implement malware/content scanning before handling real citizen uploads.
8. Replace the JSON-file store with PostgreSQL/PostGIS before multi-user production use. The included JSON store is suitable only for a small demo and does not provide transactional concurrency or spatial boundary enforcement.

## Other prototype

`CivicPulse/` contains a separate Java + React + Python proof-of-concept. It is not the runtime used by the primary Express application. Its AI endpoint is rule-based demo analysis, not a trained image-recognition model.

## Security improvements in this revision

- Public registration can no longer self-assign administrator privileges.
- Login and registration have basic per-IP rate limits.
- New passwords use versioned PBKDF2-SHA512 hashes with 210,000 iterations; existing legacy hashes remain verifiable.
- Complaint notes require authentication and ownership (or administrator) access; media uploads use owner access or a one-time, hashed upload capability returned only at submission.
- The destructive demo reset endpoint requires administrator access.
- Uploads accept a narrow allowlist of MIME types and extensions.
- Production CORS is allowlist-based and security response headers are set.
- JSON persistence uses an atomic temporary-file replacement.

## Known production gaps

This revision improves the existing project but does not certify it as production-ready. The primary app still uses a JSON file rather than PostgreSQL/PostGIS, has no authoritative Mangaluru MCC boundary polygon enforcement, and needs stronger media validation/storage, automated integration tests, and a proper deployment secret-management process.


## Additional hardening (latest revision)
- Server-side complaint validation with category allowlisting, bounded fields and coordinate sanity checks.
- Complaint submission throttling and server-controlled priority selection.
- Explicit complaint status transition validation.
- Hashed-at-rest bearer session tokens for newly issued sessions.
- Upload signature checks in addition to MIME/extension allowlists.
- Public views anonymize reporter names and mask contact details.
- Production CORS fails closed for unlisted origins.
- Automated Node.js tests (`npm test`) for validation and workflow rules.

See `server/README_SECURITY.md` for limitations and the production hardening checklist.


## Reliability update — v3 hardening
- The JSON store now fails closed when an existing data file is malformed or has invalid collection types; it no longer silently starts with a fresh seed dataset and overwrites the damaged file.
- Added operational health metadata for the active storage adapter.
- Added validated backup and restore utilities. Restore requires explicit `--yes` and creates a pre-restore safety copy.
- Added automated tests for corruption handling, backup creation, restore confirmation, and safety-copy preservation.
- The active Node.js API can use a persistent data path via `DHWANI_DATA_FILE`; set it to a durable mounted volume on a hosting platform.
- Backup output can be directed with `DHWANI_BACKUP_DIR`.

### Backup and restore
From `Dhwani/server`:
```bash
npm run backup
# Restore only after stopping the server and verifying the backup:
npm run restore -- ./backups/dhwani-YYYY-MM-DDTHH-MM-SS-sssZ.json --yes
```

### Important architecture note
The root `server/` + `app.js` + `index.html` application is the current primary Dhwani implementation. `CivicPulse/` is a separate experimental Java/React/Python prototype; it is not wired into the primary app and should not be deployed as if it were the same backend. The current primary server still uses a single-process JSON file store. For a real multi-instance public deployment, complete a tested PostgreSQL/PostGIS migration before handling production citizen data.


## Dhwani V4 — privacy hardening
- Public complaint responses no longer expose reporter account IDs, phone numbers, email addresses or upload authorization token fields.
- Authenticated complaint owners and administrators continue to receive their authorized complaint details.
- Added baseline browser security headers and production-only HSTS.
- Added automated privacy regression tests.
- Existing public complaint descriptions, locations, coordinates and media are still visible; treat those fields as public information until private media delivery and a verified disclosure policy are implemented.

### Verification
From `server/`, run `npm test`. The suite covers complaint validation, workflow transitions, corrupted-data protection, backup/restore safeguards and public-response privacy. It is not a full penetration test or end-to-end deployment test.
