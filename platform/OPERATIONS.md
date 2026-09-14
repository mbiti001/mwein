# Mwein HMIS production operations

Production release is deliberately separate from application build and from first-time provisioning.

## Release order

1. Take and externally retain a verified database backup.
2. Run `npm run release:migrate` as a controlled release job with production `DATABASE_URL`.
3. Deploy the immutable application build (`npm run vercel-build`). The build never migrates or seeds a database.
4. Check `/api/health` for liveness and `/api/ready` for production readiness. Do not direct clinical traffic while readiness is blocked.
5. Run `npm test`, `npm run test:migrations`, `npm run test:e2e`, and `npm run test:browser`, then record the release evidence in Administration → Release gates. Browser runners without a system Chrome installation must first install Chromium with `npx playwright install chromium`.

Run `npm run db:bootstrap` only for explicit first-time provisioning or a reviewed role/catalogue change. `BOOTSTRAP_ADMIN_PASSWORD` is required to create the initial administrator; reruns do not reactivate a disabled account or overwrite facility metadata.

## Required production configuration

- `DATABASE_URL`: least-privilege application database role; TLS required at the provider.
- `AUTH_SECRET`: at least 32 random characters, stored in the deployment secret manager.
- `APP_ORIGIN`: exact public HTTPS origin used by same-origin mutation protection.
- `EXTERNAL_IDENTITY_PROVIDER`: approved workforce identity/MFA provider reference.
- `AUDIT_RETENTION_TARGET`: approved immutable external retention target.
- `DATABASE_BACKUP_TARGET`: approved encrypted backup target.
- `VERCEL_GIT_COMMIT_SHA` or `DEPLOYMENT_VERSION`: immutable release identity.

## Backup and restore evidence

Set an explicit dedicated `BACKUP_DIR` and run `npm run ops:backup`. The command creates a PostgreSQL custom-format dump and a SHA-256 checksum. Transfer both to the approved encrypted backup target; the local directory is not the retention control.

At the agreed cadence, create a disposable isolated PostgreSQL database, set `RESTORE_DATABASE_URL` and `BACKUP_FILE`, and run `npm run ops:restore-drill`. The script refuses to target the configured source `DATABASE_URL`. Run application smoke tests against the restored database, destroy the disposable database through the provider, and attach the results to the Backup and restore governance gate.

## Audit retention

An authorized auditor downloads `/api/admin/audit/export`. The response verifies the serialized facility chain before returning and includes its SHA-256 in `x-audit-export-sha256`. Run `npm run ops:audit-verify -- /absolute/path/to/export.json` independently, then place the export and digest in the approved immutable retention target. Legacy version-1 event count is reported separately because events predating facility-scoped chain version 2 cannot be retroactively re-chained without destroying original evidence.

## Incident and downtime rules

Alert on 5xx rate, `/api/health` failure, `/api/ready` failure, repeated login throttles, audit-chain export failure, backup failure, and migration failure. Logs must be shipped off-host with access controls and must never include request bodies, passwords, session cookies, clinical notes, or patient identifiers.

If a clinical save fails, staff must not infer it succeeded. Use the facility downtime register, reconcile from the immutable audit and domain records after recovery, and record the incident under the approved response plan.
