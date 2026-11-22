# Dhwani security and validation notes

## Added in this revision
- Complaint payload validation: supported category allowlist, bounded text fields, contact validation, paired coordinate validation and geographic numeric ranges.
- Complaint creation throttling (8 requests per IP per hour; use a shared limiter store for multi-instance production).
- Server-controlled priority assignment; clients cannot elevate their own complaint priority.
- Explicit complaint status transition rules to prevent invalid workflow jumps.
- Session bearer tokens are stored as SHA-256 hashes for newly created sessions. Existing plaintext sessions remain temporarily readable for migration compatibility and should expire within 30 days.
- Production CORS rejects unlisted browser origins; set `CORS_ORIGIN` to the exact deployed origin(s).
- Upload content-signature checks for JPEG, PNG, WebP, MP4/MOV and WebM after Multer writes the file.
- Public complaint views anonymize reporter names and mask contact details.
- API responses use `Cache-Control: no-store`.

## Important production limitations
This application still uses a local JSON file as its primary database. It is not safe for concurrent multi-instance production writes. Uploaded media is still served from the public `/uploads` path. Signature checks are not malware scanning. The coordinate checks validate numeric geographic ranges only; they do not prove that a point lies inside the official Mangaluru City Corporation boundary. Use PostgreSQL/PostGIS, authoritative MCC boundary data, private object storage, malware scanning, shared rate limiting, monitoring and independent security testing before handling real citizen data.

## Test
Run:
```bash
npm test
```
The automated tests currently cover complaint payload validation and allowed status transitions. They are not a substitute for end-to-end, load or penetration testing.


## Reliability and recovery controls
- Existing malformed JSON now stops startup with a clear error instead of silently initializing a new dataset.
- `GET /api/health` includes basic storage readiness metadata; it is not a deep external dependency monitor.
- `npm run backup` validates the data file before creating a private backup.
- `npm run restore -- <backup-file> --yes` validates the source, creates a pre-restore safety copy and then replaces the active file. Stop the application before restoring.
- Set `DHWANI_DATA_FILE` to a durable volume path and `DHWANI_BACKUP_DIR` to a separate persistent backup location.

The JSON adapter remains single-process and is not safe for horizontal scaling or concurrent multi-instance writes. Backups on the same disk do not protect against disk loss. Keep off-host encrypted backups and complete a PostgreSQL/PostGIS migration before production use.


## Public API privacy hardening (V4)
- Public complaint responses no longer include the reporter's internal user ID, phone number, email address, or upload authorization token fields.
- Public reporter display names are generic (`Citizen`); authenticated owners and administrators retain access to their own/authorized full complaint details.
- The API sets baseline browser security headers, including MIME sniffing protection, clickjacking protection, a restrictive referrer policy and a permissions policy. HSTS is enabled only when `NODE_ENV=production` (deploy behind HTTPS).
- A Content Security Policy is not enabled automatically because the existing app loads map and library resources from external origins. Define and test a CSP against the actual deployment origins before enabling it.

Public complaint descriptions, location fields, map coordinates and attached media remain public in this version. Do not include sensitive personal details in complaint descriptions or upload images containing private information. Private media storage and authenticated media delivery remain production work.


## V4 verification
Run `npm test` from this directory. The suite currently includes 13 automated tests. These cover validation helpers, status transition rules, data corruption handling, backup/restore safeguards and public-response privacy. They do not establish production readiness and do not replace API integration, browser, load, GIS or independent penetration testing.
