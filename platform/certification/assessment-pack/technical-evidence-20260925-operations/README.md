# Operations evidence collected 25 September 2026

Read-only evidence; no database dump, SSD write, restore, provider configuration change or sign-off performed.

## Findings

- Vercel project `mwein-hmis-platform`: root `platform`, configured Node 24.x. Live deployment `dpl_ECihvPauEWwG7fGjvEnatfu5di3s` is Ready; listed functions report `iad1`. Full project/deployment CLI outputs retained.
- Public health now reports `83fdd6133c024ce057ef87d12bef4e7577635b84`, migration `20260924130000_workforce_mfa`, database connected. Git comparison with earlier manually promoted `1d1e5ea` shows only three certification documentation files changed. The main-branch deployment supersedes the earlier deployment observation; runtime source is unchanged by that documentation difference.
- Public TLS connection passed certificate verification, negotiated TLS 1.3 / TLS_AES_128_GCM_SHA256. Certificate issuer/validity/fingerprint retained in public-probes.json. This observation covers the public endpoint at collection time, not database TLS, stored data, all protocols or provider key custody.
- Readiness remains 503/blocked. Unauthenticated patients API returns 401 with private/no-store.
- Vercel marketplace read-only listing reports Neon resource `neon-alizarin-bridge` Available, resource ID `store_IlKu7vJQ6OIi42Oe`. Resource inspection did not establish database region, encryption or retention. No provider secrets were retrieved.
- `diskutil list external physical` exited successfully with empty device inventory. No attached external physical SSD was visible. This says nothing about Charles's unconnected drive or its encryption. `pg_dump`, `psql` and `pg_restore` were not found on the operator PATH; a compatible toolchain remains required before the real exercise.

## Backup preparation fix

The previous backup runner passed the connection URL in process arguments and forwarded tool output. The revised runner uses validated libpq environment variables, removes inherited PG redirect overrides, withholds subprocess diagnostics, reserves a unique mode-0600 partial file, bounds tool execution, creates the checksum after success and cleans incomplete outputs on handled failures. The protected directory/volume must still be independently approved and encrypted; the runner does not encrypt the dump. Abrupt host/power failure can leave a partial file, so operators must inspect the protected directory after interruption.

Targeted simulated backup/restore tests: 20 passed. Full platform unit run: 80 files / 364 tests passed. These tests use fake PostgreSQL executables and synthetic content; they are not a real database backup/restore. Script hashes in the manifest identify the tested backup implementation.

## Remaining execution inputs

Charles connects and identifies the SSD; verify encryption without revealing the unlock key. Edwin names an independent observer and approves measurable RPO/RTO. Operations supplies an approved distinct disposable PostgreSQL target and compatible client tools. Confirm protected source access, backup/key custody and cleanup plan before executing. Provider project-specific encryption, database region/TLS and DPA/transfer records remain outstanding. DPO consultation and signature have not occurred.
