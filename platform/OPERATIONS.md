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

Set an explicit dedicated `BACKUP_DIR` and run `npm run ops:backup`. The command creates a PostgreSQL custom-format dump and a SHA-256 checksum. Use an approved encrypted destination volume: the dump itself is not encrypted. Connection credentials are passed through validated libpq environment variables rather than process arguments; raw tool diagnostics are withheld. Files are private and incomplete outputs are removed on handled failures. After interruption or power loss, inspect the protected directory for partial files before retrying. Transfer both to the approved encrypted backup target; the local directory is not the retention control.

At the agreed cadence, create a disposable isolated PostgreSQL database, supply the independently reviewed restore approval and source/target/backup settings described under “Verified disposable restore plan”, and run `npm run ops:restore-drill`. The script requires verified distinct approved database systems before restoration. Run application smoke tests against the restored database, destroy the disposable database through the provider, and attach the results to the Backup and restore governance gate.

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

## DHA access-control release: reporting permissions

The remediation branch separates `reports.clinical` from `reports.operations` and from `billing.read`. Review this proposed definition map before production provisioning:

| Permission | Roles |
|---|---|
| reports.clinical | FACILITY_ADMIN, MEDICAL_DIRECTOR |
| reports.operations | FACILITY_ADMIN, FINANCE_MANAGER, AUDITOR |
| reports.prepare | FACILITY_ADMIN, MEDICAL_DIRECTOR |
| reports.review | MEDICAL_DIRECTOR |

Billing, clinician shortage cover and system-administrator-only accounts do not gain these reporting permissions. Clinical reports contain diagnosis aggregates; operations reports contain facility workload, finance, stock and staff-attributed collection summaries. The scoped `scripts/release-report-permissions.mjs` requires `APPROVE_REPORT_ROLE_MAP=true`, synchronizes only these four permission definitions/grants, assigns no users and changes no credentials. Never run the full bootstrap against production. New roles/permissions are seeded automatically only in isolated test/bootstrap environments. DPO role provisioning uses the existing scoped privacy-role script if needed; DPO assignment uses governed Staff access.

Application deployment before permission provisioning denies reports until the reviewed grants exist. Role permissions are resolved from the database on each authenticated request. A role change still revokes the affected user's sessions. Retain role-map approval and deployment/source evidence, and test denial for billing/cover and clinical denial for finance after rollout. No rollout was performed by the implementation task.

## Verified disposable restore plan

`ops:restore-drill` now requires **DATABASE_URL**, **RESTORE_DATABASE_URL**, **BACKUP_FILE** and **RESTORE_APPROVAL_FILE**. The approval file must be stored with restricted access outside source control and contain:

```json
{
  "disposable": true,
  "approvedBy": "named independent reviewer",
  "reference": "protected drill approval reference",
  "expiresAt": "future ISO timestamp chosen by the reviewer",
  "sourceIdentityHash": "SHA-256 of normalized source connection identity",
  "targetIdentityHash": "SHA-256 of normalized target connection identity",
  "sourceSystemIdentifier": "verified PostgreSQL system identifier",
  "targetSystemIdentifier": "verified DISTINCT PostgreSQL system identifier",
  "backupSha256": "SHA-256 of the approved backup file"
}
```

Use `identityHash` exported by `scripts/restore-safety.mjs` to derive connection identity digests in a protected operator environment. The hash covers normalized host/port/database, not credentials. The reviewer must independently establish which provider resources these identities represent; the file must not be mechanically self-approved from arbitrary URLs.

The runner rejects absent source, equivalent/pooler connection identities, unsupported connection overrides, expired/mismatched approval and checksum mismatch before database commands. It then reads each server's system identifier with `psql -X` and checks both against the approved plan. Missing permission to read `pg_control_system()` fails closed. Shared/cloned system identifiers are conservatively rejected even if database names differ: arrange a genuinely distinct disposable PostgreSQL system, rather than weakening the check. Both `psql` and `pg_restore` must be installed.

`pg_restore` receives only the decoded database name as its dbname argument; the runner maps the validated connection into libpq environment parameters and removes inherited PGHOSTADDR/PGSERVICE/PGOPTIONS overrides, keeping credentials out of process arguments; restoration stops on error and runs in one transaction. Treat the backup/approval files, runtime environment and provider routing as protected operator inputs and keep them stable throughout execution. Tool stderr is withheld from general logs. Follow restoration with integrity/application smoke checks and measured RPO/RTO; a successful command alone is not recovery acceptance.

Automated tests exercise guards and process ordering with simulated PostgreSQL tools. They do not prove an actual independent backup restore. A witnessed real drill remains outstanding.

Connection handling follows PostgreSQL’s [libpq environment parameters](https://www.postgresql.org/docs/current/libpq-envars.html) and [pg_restore connection options](https://www.postgresql.org/docs/current/app-pgrestore.html). Operator environments must remain private.


## Local reporting draft/review release

Apply migration `20260924100000_local_report_revisions` using the normal reviewed migration release process before deploying this feature, then provision the four reporting permission definitions above with the scoped script. This migration adds a local reporting table, status enum, approval-evidence constraints and an immutable-approved-history trigger. It does not seed county contacts, national datasets or users. Do not use the unpublished MFA migration from another checkout.

In **Reports → Local reporting drafts**, select a month, enter aggregate indicator counts and a non-identifying source/register reference, then save. Blank counts are missing, not zero. An all-zero worksheet requires explicit confirmation before review. Save edits, give a reason and request review. A medical director who has not contributed to this revision can return it with a reason or approve it. Approval freezes its payload. Later corrections create a linked draft and retain the original approval and values. All inherited contributors remain in a correction's contributor list, so an independent reviewer must remain available. No shortage-cover exception to independent approval is implemented.

These are manual local worksheets under `LOCAL_MANUAL_AGGREGATE_V1`; arbitrary indicator labels do not become approved national indicator definitions. They do not calculate a weekly IDSR return, classify a reportable disease, prove source-register reconciliation, notify the county or submit to KHIS. The interface and API label national configuration as pending and submission as not performed. Facility scoping derives from the authenticated account; Busia/Nambale/MFL 31749 are not hard-coded into other facilities.

Reads are audited before disclosure. Mutations and their audit entries commit together. Optimistic versions plus serializable transactions reject concurrent/stale changes; duplicate correction creation is constrained. API reads are limited to the 100 newest revisions in a selected month and explicitly signal truncation; older records remain stored. Extend retrieval before relying on the interface for facilities exceeding that volume. No delete or outbound-delivery API is provided.

Before production activation: retain migration/recovery evidence, authorize the reporting role map, ensure a separate qualified reviewer is assigned, and verify facility boundaries and the review/correction flow with synthetic records. Reporting permission provisioning, production migration and deployment were not performed in this implementation task.

## Local IDSR register release

[Implementation scope and staff workflow](certification/LOCAL-IDSR-IMPLEMENTATION.md) describes the local case/event register and manual notification history. The release adds migration `20260924110000_local_surveillance`; apply it before exposing the workspace.

| Permission | Proposed role grants |
|---|---|
| surveillance.read | NURSE, CLINICIAN, CLINICIAN_COVER, MEDICAL_DIRECTOR |
| surveillance.record | NURSE, CLINICIAN, CLINICIAN_COVER, MEDICAL_DIRECTOR |
| surveillance.review | MEDICAL_DIRECTOR |

Use the scoped `scripts/release-surveillance-permissions.mjs` with `APPROVE_SURVEILLANCE_ROLE_MAP=true` after role-map review. It changes no user assignments. Finance, facility-admin-only and system-admin-only accounts must remain denied case-level access. Verify capture without patient identity, manual notification before review, independent facility isolation, corrections, closure/reopening and immutable history using synthetic records before activation. Local review is recorded as a clinical-role action, not an independent certification sign-off.

The application never sends a notification or asserts verified county receipt. Staff should document actions already taken through their established reporting route and reference protected evidence; no contact list, case definition, automatic threshold or deadline has been configured. A manual acknowledgement is explicitly unverified by the receiving service. Notifications may be recorded before review and after local closure. Reopen a closed concern before changing its case details; append a correction note to clarify mistaken history entries.

## Measured vitals release

Migration `20260924120000_measured_vitals` adds append-only measurement history and the nurse-reviewed source link. After applying the pending migrations, review and run `APPROVE_VITALS_ROLE_MAP=true node scripts/release-vitals-permissions.mjs` using the approved target connection. This grants only `vitals.write` to Reception, Nurse, Clinician, Clinician Cover and Medical Director. It does not assign users, reset credentials or grant clinical triage to Reception. Do not use bootstrap for production provisioning. Verify the handoff in staging and refresh sessions after provisioning; see [workflow review](certification/assessment-pack/WORKFLOW-STANDARDIZATION-REVIEW.md).

## Workforce MFA and updated readiness checklist

Follow [MFA onboarding, key custody and recovery requirements](certification/WORKFORCE-MFA-IMPLEMENTATION.md) before rollout. Migration `20260924130000_workforce_mfa` is required before the new build. Explicitly configure `MFA_REQUIRED=true`, safeguard AUTH_SECRET and enroll separate recovery administrators. Password reset does not remove MFA. Lost-factor recovery requires another authorized administrator with a recent MFA sign-in and a protected identity-check record reference.

Run `ENFORCE_AUDIT_COVERAGE=true npm run ops:audit-coverage`. Review changed routes before updating their hashes in `certification/audit-route-review.json`; do not automatically approve an exception after code changes. See [current remaining-work status](certification/assessment-pack/REMAINING-WORK-STATUS.md). App implementation and configuration are not substitutes for approved operational evidence.
