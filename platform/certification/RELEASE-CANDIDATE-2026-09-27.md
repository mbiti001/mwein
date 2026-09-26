# Release candidate — 27 September 2026

Source branch: `codex/main-action-fixes`, based on deployed main `c0a71c77615875bf5f969bf934d3f1f42f336e09`. This is preparation for a release, not approval for patient use. No production secrets, database, deployment or patient records were changed.

## Included changes

The [action-fix review](MAIN-ACTION-FIXES-2026-09-27.md) describes button feedback, duplicate-payment protection, stock calculations and facility-scoped dispensing retries. Payment replay requires migration `20260927090000_payment_replay` before the new application starts. Clients must supply the new UUID `idempotencyKey`; unchanged retries must reuse it. The migration adds a table and indexes without rewriting existing payments. Older payments with reused external references return a review-required conflict.

Production readiness now requires valid ICD-11 credential configuration and a valid release month. Redacted exports are treated as missing configuration and are never sent to WHO. Configuration presence does not prove WHO availability: the live check below remains required. The existing Production ICD credentials remain in Vercel. Local automated tests are offline and do not substitute for live integration acceptance.

`ops:release-verify` verifies the deployed commit and migration only. The new `ops:patient-use-verify` additionally requires HTTPS and `/api/ready` to return HTTP 200 with `status: ready`. It fails if configuration or governance evidence is incomplete. Existing readiness requirements have not been bypassed. Test fixtures, test sources, local environments and certification evidence are excluded from deployment uploads at both repository and platform roots.

## Validation and current live state

- 403 tests across 86 files pass, including redacted/missing WHO configuration and patient-use gate rejection.
- Type checking passes; 49 migrations and 33 required tables pass the isolated database checks, including `PaymentRequest`.
- Production dependency audit reports zero known vulnerabilities. This is not a penetration test.
- Production observed on 27 September (Nairobi): health HTTP 200, source `c0a71c77615875bf5f969bf934d3f1f42f336e09`, migration `20260925100000_signed_clinic_documents`; readiness HTTP 503, `blocked`.
- Final build and browser outcome are recorded in the accompanying validation summary.

## Release procedure

1. Freeze the reviewed source commit. Run `npm run ops:release-preflight` from a clean checkout and retain its migration digest and exact commit. Install with `npm ci`; generate Prisma, run types/tests/migrations and build. CI must pass for this same commit.
2. Retain a verified current production backup and a tested restore/rollback procedure with named owners. Reconcile the current migration head. Do not run bootstrap, test fixtures or seeds against Production.
3. Keep the existing Vercel project and its Production secrets. Do not upload `.env.local`, use redacted exports as credentials, set `MFA_REQUIRED=false`, or copy offline test overrides into deployment settings.
4. Apply `npm run release:migrate` in the authorised production release environment before activating code requiring the new table. Retain migration output and database health evidence. Keep the previous deployment for rollback; preserve the additive replay table and financial records rather than dropping them.
5. Deploy the reviewed source, then set `RELEASE_ORIGIN`, `EXPECTED_RELEASE_SHA` and `EXPECTED_MIGRATION=20260927090000_payment_replay` in the verification environment and run `npm run ops:release-verify`.
6. In the authorised server environment with the existing WHO secrets, run `npm run ops:icd11-verify`. Retain metadata only. Witness a clinician search, selection and save in the approved acceptance environment. No patient identifiers should be sent as terminology queries.
7. Complete clinical/finance UAT, staff MFA/recovery acceptance, privacy/security and backup/downtime evidence with their accountable owners. Review the existing governance gates in Administration; do not insert placeholder approvals. Run `npm run ops:patient-use-verify`. A healthy deployment alone is insufficient for patient-use approval.

## Remaining blockers

The publicly observable readiness gate is blocked. Its details require an authorised Administration session; no missing approval is inferred as completed. The existing [readiness assessment](DHA-READINESS-20260925.md) identifies accountable evidence owners. Live WHO verification of this release, clinical acceptance, independent security and recovery evidence, and exact production migration/release verification remain separate from local regression tests. No DHA certification or patient-use approval is asserted.
