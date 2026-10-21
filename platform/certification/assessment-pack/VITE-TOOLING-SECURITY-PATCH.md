# Vite development dependency correction — 21 October 2026

The previous assessment-history audit identified one high-severity development dependency advisory at Vite 8.2.2. The current full baseline audit reproduced that result. The production dependency tree was unaffected by the reported advisory.

## Change and verification contract

Pin the existing transitive Vite dependency to **8.2.4** with an explicit npm override. This keeps Vitest 4.1.11 and the existing Vite minor line while selecting the maintainer-listed patched version. The generated lockfile changes only Vite's version, tarball URL and integrity. Its `dev: true` classification is retained. No production dependency, application code, schema, migration, clinical threshold, UI or version changes are included.

The existing CI advisory gate now runs `npm audit --include=dev --audit-level=high`, so high/critical development advisories fail the same verification job as production advisories. This explicitly includes development dependencies even if an inherited npm configuration omits them. It does not claim that audit detects every vulnerability. Future tooling updates should review and update/remove this override deliberately; do not leave an obsolete security pin indefinitely.

Validation requires a clean locked install, the full unit suite on the patched Vite runner, types, migration verification, production build and exact-source hosted verification. Existing authorization, facility isolation, audit history, failure recovery and desktop/tablet/phone/print regressions remain unchanged. No new test mirrors the version constant, and no malicious editor command is executed. Retain the actual command results, source archive and build identity in the companion evidence JSON; pending hosted checks must not be reported as completed.

## Primary source and limits

The [maintainer advisory GHSA-587h-7wmj-h5pm](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm), checked on 21 October 2026, identifies Vite 8.2.4 as patched. It describes Windows path validation in launch-editor and links a related argument-escaping issue. The npm registry metadata independently supplies the selected version's integrity. This is dependency remediation, not a demonstration that the Mwein test configuration was exploitable or an independent security approval. No Vite development server is exposed by this batch.

## Release and next work

Read-only production identity before this batch remains **1.6.2 / 89e693df430571b9371cefad7db1e750ae41fe30 / dpl_F3uShagMUnYftappZnbrmSdTf42T**, database connected and migration `20261016010000_rights_identity_evidence` unchanged. The originally authorized release is complete. This tooling correction and the later application corrections are not promoted by this batch. Preserve the separate cancellation PR #11 and all exact-source release, MFA, clinical-readiness and future database-backup gates. The October 15 backup exception is not reused.

After this maintenance batch, implement the structured assessment history/amendment contract in `SERVICE-ASSESSMENT-HISTORY-AUDIT.md`, then unsaved assessment navigation/reload protection. Keep financial/supply session attribution, changed-payload stock replay, diagnostic offered/accepted handover, pharmacy clarification, cashier reconciliation and attributable follow-up in the backlog. Do not repeat the completed lifecycle, original-revision, value/session corrections or history characterization audit.
