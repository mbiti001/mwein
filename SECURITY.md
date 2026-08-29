# Security Notes

The current application is a full-stack engineering pilot. It must not be used for real patient records until the remaining security, privacy, clinical safety, and certification controls are implemented.

## Current Demo Controls

- The Node service applies content security, framing, MIME-sniffing, referrer, and permissions headers.
- The app avoids external scripts, fonts, and images.
- Patient, encounter, prescription, and audit data are persisted in SQLite with foreign keys and transactional encounter signing.
- API bodies are size-limited and structured inputs are validated server-side.
- Patient identifiers and phone numbers are checked for duplicates.
- API GET responses bypass the PWA cache.
- Staff passwords use salted scrypt hashing and sessions use hashed random tokens in HTTP-only, same-site cookies.
- Clinical routes enforce role permissions for registration, prescribing, and encounter signing.
- Prescription saves rerun allowlisted safety checks on the server and reject blocked or unacknowledged review results.
- Sign-in failures are audited and throttled per client address.
- State-changing API calls reject cross-origin browser requests.
- Production rejects unexpected hosts and non-HTTPS application traffic.
- CSP nonces restrict executable inline scripts and HSTS is enabled in production.
- Public-file allowlisting prevents download of source, secrets, and database files.
- Sessions enforce idle and absolute expiry and use `__Host-` secure cookies in production.
- Audit events are hash-chained and checked by the readiness endpoint.
- `EMR_API_KEY` supports trusted machine integrations with constant-time token comparison.
- The PWA app shell and local drafts can work offline for demonstration.
- `robots.txt` blocks indexing.

## Production Requirements

- Use HTTPS only.
- Add MFA and secure staff identity management.
- Enforce role-based access control on the server, not only in the UI.
- Encrypt patient data at rest and in transit.
- Replace local pilot accounts with identity-provider MFA and managed staff account lifecycle controls.
- Move audit events to append-only storage with independent retention.
- Perform regular backups and recovery drills.
- Export audit events to append-only external retention; the local hash chain detects modification but does not prevent database administrators from replacing the full store.
- Define incident response and breach notification procedures.
- Complete DPIA, data retention, access review, and processor/controller documentation.
- Validate all clinical safety rules, especially allergy and medication checks, with licensed clinicians.
- Pin, sign, review, test, and audit every clinical plug-in release; prohibit runtime loading of arbitrary third-party code.
- Replace free-text allergy matching and sample stock flags with governed coded terminology and authoritative pharmacy inventory integrations.

## Reporting Issues

For this prototype, document issues in the project tracker or deployment review notes. For a production system, establish a formal security contact and disclosure process before launch.
