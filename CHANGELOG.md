# Changelog

## Dhwani hardening update — 22 November 2026
- Added strict server-side validation for complaint category, text fields, contact information and coordinate ranges.
- Limited complaint submissions to 8 per IP per hour (single-process in-memory limiter).
- Priority is now assigned by server-side category policy rather than trusted from the browser.
- Added a status transition state machine to prevent invalid workflow jumps.
- New session bearer tokens are stored as SHA-256 hashes; legacy session records remain temporarily compatible.
- Added file-signature checks for supported image/video formats.
- Anonymized reporter names in public complaint views and retained masked contact details.
- Production CORS now rejects unlisted origins.
- Added eight automated Node.js tests covering validation and status workflow rules.

## Limitations not yet solved
- JSON file persistence is still the active database.
- No PostGIS-backed Mangaluru City Corporation polygon enforcement is implemented.
- Uploads still use local public static storage; no malware scanning or private object storage.
- Rate limiting is in-memory and not shared between instances.
- Automated tests do not yet exercise the complete HTTP API, database concurrency, GIS, or browser workflows.


## Reliability and operations update — 22 November 2026
- Fail-closed JSON loading prevents malformed existing data from being silently replaced by a new seed database.
- Added storage health metadata to `/api/health`.
- Added validated JSON backup and guarded restore scripts with explicit confirmation and a pre-restore safety copy.
- Added automated tests for data corruption protection, backup validation and restore safeguards.
- Added configurable persistent data and backup paths.
- Documented that the Node.js app is the primary implementation and `CivicPulse/` is a separate prototype, avoiding accidental deployment of mismatched stacks.


## V4 privacy hardening — 22 November 2026
- Removed reporter account IDs and direct contact details from public complaint API responses.
- Removed upload authorization token fields from public complaint responses.
- Preserved full details for authenticated complaint owners and administrators.
- Added baseline browser security headers; HSTS is applied only in production mode.
- Added public-response privacy regression tests.
- 13 automated tests pass; all checked JavaScript files pass syntax validation.
