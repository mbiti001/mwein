# Mwein HMIS production operations

Production release is deliberately separate from application build and from first-time provisioning.

## Deployment target and CI

Set the hosting project root to `platform/`, framework to Next.js, install command to `npm ci`, and build command to `npm run vercel-build`. The root repository's `vercel.json`, Dockerfile and cloud bundle are legacy-only. Preview environments must never receive production database credentials.

Require the GitHub **Platform verification** check in branch protection/rulesets. It verifies types, unit tests, migrations, the production build, the isolated outpatient flow and browser workflows. Merely adding the workflow does not configure branch protection. Build jobs need no live database credentials; database changes run in a separately authorised release context.

## Release order

1. Take and externally retain a verified database backup.
2. Run `npm run release:migrate` as a controlled release job with production `DATABASE_URL`.
3. Deploy the immutable application build (`npm run vercel-build`). The build never migrates or seeds a database.
4. Check `/api/health` for liveness and `/api/ready` for production readiness. Do not direct clinical traffic while readiness is blocked.
5. Run `npm test`, `npm run test:migrations`, `npm run test:e2e`, and `npm run test:browser`, then record the release evidence in Administration → Release gates. Browser runners without a system Chrome installation must first install Chromium with `npx playwright install chromium`.
6. Verify the deployed source and database are the approved pair: `RELEASE_ORIGIN=https://... EXPECTED_RELEASE_SHA=<full commit> EXPECTED_MIGRATION=<migration name> npm run ops:release-verify`. Retain the output with the deployment approval. A mismatch is release drift and blocks clinical use.

Run `npm run db:bootstrap` only for explicit first-time provisioning or a reviewed role/catalogue change. `BOOTSTRAP_ADMIN_PASSWORD` is required to create the initial administrator; reruns do not reactivate a disabled account or overwrite facility metadata.

## Required production configuration

- `DATABASE_URL`: least-privilege application database role; TLS required at the provider.
- `AUTH_SECRET`: at least 32 random characters, stored in the deployment secret manager.
- `APP_ORIGIN`: exact public HTTPS origin used by same-origin mutation protection.
- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`: approved workforce identity provider configuration. Provider groups must be mapped to operational roles in Administration; external identity can never grant `SYSTEM_ADMIN`.

Before enabling provider login, run `npm run ops:oidc-verify` in the release environment. Retain its output, then separately test state/nonce/PKCE callback rejection, logout, MFA assurance claims, deprovisioning and the governed emergency-access procedure with approved test accounts. Discovery success alone does not enable OIDC or prove MFA.
- `AUDIT_RETENTION_TARGET`: approved immutable external retention target.
- `DATABASE_BACKUP_TARGET`: approved encrypted backup target.
- `VERCEL_GIT_COMMIT_SHA` or `DEPLOYMENT_VERSION`: immutable release identity.

## Backup and restore evidence

Set an explicit dedicated `BACKUP_DIR` and run `npm run ops:backup`. The command creates a PostgreSQL custom-format dump and a SHA-256 checksum. Transfer both to the approved encrypted backup target; the local directory is not the retention control.

At the agreed cadence, create a disposable isolated PostgreSQL database, set `RESTORE_DATABASE_URL` and `BACKUP_FILE`, and run `npm run ops:restore-drill`. The script refuses to target the configured source `DATABASE_URL`. Run application smoke tests against the restored database, destroy the disposable database through the provider, and attach the results to the Backup and restore governance gate.

## Audit retention

Patient searches, patient history, active visit worklists, visit summaries and verified diagnostic-result reads now append `CLINICAL_RECORDS_ACCESSED` before returning data. The event records the user, session, facility, fixed workflow context and resource references, without names, search text or clinical notes. A list produces one event containing its resource references; even an empty search is recorded. Responses use `private, no-store`. If the append fails, these endpoints return an error instead of disclosing records; use the approved downtime procedure during an audit-storage outage.

These events record authorised server disclosure, not proof of viewing, printing or external delivery. Other endpoints, denied-access monitoring and infrastructure log retention still require a complete coverage review. Audit exports themselves remain sensitive because resource references can identify records.

The public `/api/ready` response contains only `status` and HTTP 200/503. Configuration diagnostics remain in the permission-protected Administration overview; facility governance evidence remains in Release gates. The endpoint is a probe, not an automatic traffic-admission control.

An authorized auditor downloads `/api/admin/audit/export`. The response verifies the serialized facility chain before returning and includes its SHA-256 in `x-audit-export-sha256`. Run `npm run ops:audit-verify -- /absolute/path/to/export.json` independently, then place the export and digest in the approved immutable retention target. Legacy version-1 event count is reported separately because events predating facility-scoped chain version 2 cannot be retroactively re-chained without destroying original evidence.

## Required operating schedule

Configure these in the approved infrastructure scheduler after the external destinations and credentials exist. Do not run them inside the request-serving deployment:

- Encrypted database backup: at least daily, with provider retention and failure alerting; run `npm run ops:backup` and transfer both dump and checksum.
- Independent restore drill: quarterly and before material database-provider changes; run `npm run ops:restore-drill` against a disposable database.
- Verified audit export: daily for active facilities; download the authorized facility export, run `npm run ops:audit-verify`, and retain the export plus digest immutably.
- Readiness and liveness probes: every minute from an external monitor; `/api/health` detects service/database failure and `/api/ready` deliberately stays blocked until every production gate is approved.

Record every successful run, failure, recovery time and retained evidence reference in the facility operations register. Environment-variable placeholders are readiness checks, not proof that backups, retention or MFA are operating.

Administration → Operations evidence is the in-application register for backups, restore drills, audit exports, incidents and downtime rehearsals. Successful or resolved entries require a retained evidence reference, and a second administrator must verify each entry. The register records evidence metadata; it does not replace the encrypted external artifact or immutable retention target.

## Daily financial close

Each cashier opens a shift before accepting cash. At close, the cashier records counted cash and explains every non-zero variance; a different user with the finance-manager approval permission must approve the submitted reconciliation. Card, bank and mobile-money receipts remain traceable to their payment references but are excluded from physical cash expectations.

## Incident and downtime rules

Alert on 5xx rate, `/api/health` failure, `/api/ready` failure, repeated login throttles, audit-chain export failure, backup failure, and migration failure. Logs must be shipped off-host with access controls and must never include request bodies, passwords, session cookies, clinical notes, or patient identifiers.

If a clinical save fails, staff must not infer it succeeded. Use the facility downtime register, reconcile from the immutable audit and domain records after recovery, and record the incident under the approved response plan.
