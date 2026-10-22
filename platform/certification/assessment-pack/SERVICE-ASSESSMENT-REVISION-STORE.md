# Structured assessment revision storage foundation

22 October 2026. Baseline ba203153b752d0c2218eb38aa545834cb41dd945 on the owner-renamed codex/mwein-platform branch. This bounded batch implements the storage/migration portion of SERVICE-ASSESSMENT-HISTORY-AUDIT.md. **It is not a complete history feature or deployable database release.**

## Implemented

Migration 20261022010000_assessment_revision_store retains a complete current snapshot for each existing ServicePointRecord, including template, JSON values (false/empty/missing distinctions), risk, follow-up date, recorded user and original creation/update timestamps. A separate server-default capture time and MIGRATION_BASELINE label distinguish this observation from an original clinical event. The baseline is version 1 of the new storage sequence, not a claim that it was the first clinical edit. Historical session and predecessor are null. Existing current records and audit events are unchanged; missing old text is not reconstructed from hashes.

Composite foreign keys bind record/encounter/visit/facility; another composite FK binds the immediate predecessor within the same record. Positive contiguous versions and unique record/version prevent gaps and forks. UPDATE, DELETE and TRUNCATE are rejected by database triggers; parent deletion and context reassignment use restrictive foreign keys. PUBLIC privileges are revoked. The Prisma model mirrors relational constraints; SQL retains the additional checks/triggers. Only MIGRATION_BASELINE and session-attributed DRAFT_SAVE kinds are representable; no post-signature amendment kind or policy is introduced.

The migration is transactional and locks source tables while capturing baselines. Invalid legacy JSON shape fails and rolls back the migration rather than changing legacy data. Future production planning must assess locks, volume and malformed legacy records in an authorized environment; there was no production-data scan here.

## Verified scope

- Local 1,288 unit tests/129 files, generated Prisma client, schema validation, types, and all 56 migrations pass. Existing 55-migration evidence remains historical; this is a new migration.
- Dedicated populated migration verifier passes 34 PGlite checks and 35 native PostgreSQL checks. It tests invalid-legacy rollback, exact baseline preservation, foreign context references, missing record/recorder, null/skipped/missing predecessor, duplicate version, invalid kind/session/payload, transaction rollback, restrictive parent deletes/context changes and mutation rejection. Two native non-owner connections competing for the next version yield one retained successor and one uniqueness rejection without retry.
- A NOLOGIN/NOSUPERUSER/non-owner fixture role can read/append with grants, but cannot update/delete/truncate even with those DML privileges, or disable triggers. This is an application-role analogue, **not verification of the deployed role's ownership/grants**. Owners/superusers can disable/drop protections. No claim of superuser-proof immutability, row-level authorization or session authenticity from a UUID alone.
- Native pg_dump custom archive restored all five synthetic snapshots exactly into a new empty database. Update/delete/truncate protections remain active after restore. This demonstrates synthetic tooling compatibility, not production backup/restore acceptance.
- Exact-source hosted unit/native/browser/build checks and canonical archive are recorded in the companion evidence after push. Existing browser regressions cover compact blue/white desktop/tablet/390/320 layouts and saved-only print. No new UI, visual review, physical print or new disclosure coverage is claimed in this storage batch.

Retained setup/test failures: initial schema validation lacked DATABASE_URL; using an unreachable synthetic URL validated without production credentials. The initial parent-delete assertion expected 23503, while PGlite returned the more specific 23001 restrict_violation; the verifier now accepts those two integrity codes and confirms unchanged retained rows. Full npm audit exited nonzero for moderate advisories before the build command; the existing high/critical gate passed and the build was subsequently run explicitly. No gate was weakened.

## Integration and release boundary

**The current save route still does not append revisions, and the UI still says older structured versions are unavailable.** Preserve that characterization until the next integration batch atomically appends the persisted snapshot/session, updates projection and signer revision, and records the audit in one transaction. A future release must capture writes from its migration cutover: quiesce writes until the integrated source is running, or provide a separately tested catch-up strategy. Never deploy this foundation by itself and call post-baseline history complete.

Next: implement atomic save integration, authorized/disclosed bounded history reads and aligned saved/print presentation, then reviewed amendment lifecycle/idempotence and unsaved navigation/reload protection. Keep session evidence independent of expiring Session rows; the authorized writer must supply authenticated context and server times. Validate the intended production non-owner role and grants separately. No automatic request retry, signed/closed write permission, clinical guidance or approval is added.

The original authorized release is already complete: 1.6.2 / 89e693df430571b9371cefad7db1e750ae41fe30 / dpl_F3uShagMUnYftappZnbrmSdTf42T. This migration and the later application corrections remain undeployed. A later database release requires fresh backup reference, restore/recovery evidence, exact integrated source, coordinated promotion and all existing MFA/clinical/DHA/security readiness gates. The October 15 backup exception is not reused. Preserve cancellation PR #11. No production migration/seed, real-patient workflow, credential change or third-party message occurred.

## Newly observed tooling advisories

Full dependency audit reports two moderate affected package entries (Vitest and @vitest/mocker), zero high/critical; production-only audit is recorded separately. Locked Vitest/mocker 4.1.11 remain unchanged. Maintainer advisories [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp) list 4.1.12 as patched. They concern dev-server mock registration and Windows redirect traversal. No Vite dev server was exposed, exploit reproduction or production exploitability is claimed. Handle a separate verified tooling patch next, then resume integration. Do not report the complete dependency tree as vulnerability-free.

## Primary references checked

[PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) supports foreign keys/uniqueness rather than cross-row CHECK lookups; [privileges](https://www.postgresql.org/docs/current/ddl-priv.html) documents owner/superuser limits. [WHO DAKs](https://www.who.int/publications/m/item/who-digital-accelerator-kits) and [HosiPoa modules](https://hosipoa.co.ke/modules/) remain workflow/product references, not Mwein clinical certification. [Kenya MoH consultation notice](https://www.health.go.ke/node/1512) again failed direct retrieval; no current-law assertion is made.

Retain financial/supply attribution, changed-payload stock replay, diagnostic offered/accepted handover, pharmacy clarification, cashier reconciliation/reversals and attributable follow-up backlog after the assessment work. Do not repeat completed narrative visibility, lifecycle/revision/value-session or Vite patch batches.

### CI fixture correction

Initial exact-source CI39699301268 passed units, all56migrations and35native storage checks, then failed the existing narrative-history workflow before browser verification. Its synthetic newer draft was hard-coded to midnight22October, which is now older than the API-created encounter; this changed the fixture's selected encounter. Replaced fixed addendum/draft dates with stored maximum timestamps plus one second. Assertions, truncation, older-encounter inclusion and authorization gates remain intact; no application change or blind rerun. Retained initial failure log and source deb2a469dca8faed974f2e0166608fc802f15f71. Final source and complete CI follow after the fixture correction is verified.


## Final exact-source verification

Source **571b1c5a0bba6a6251b55f264aa1e945a70b7b0b** passed aggregate [CI 39699662190](https://github.com/mbiti001/mwein/actions/runs/39699662190) and both jobs (Platform119565539945, Legacy119565540258). Decoded logs confirm 1,288 units/129 files, 56 migrations, 35 dedicated native storage checks, 196 native workflow checks and 153 browser scenarios with zero retries, plus the production build. Existing authorization/facility/MFA/audit/failure and desktop/tablet/390/320/print regressions passed; no new UI or physical-print claim. Local build **RTs6kcAkh_6fP4H91HxSZ** predates the commit; runtime/schema/dependencies are identical between initial and final source, with a fixture/document-only follow-up. Hosted build is separate; no hosted build ID is exposed.

Canonical LF archive: 7116800 bytes, SHA256 **1b26c340c4033b2d911f4378a4f11461e6cafe1f49097ea8ce0d77a9361f92ba**. Strict audit inventory:73routes/0gaps/0unclassified/0aliases; no route fingerprints/exceptions changed. Full audit:2moderate affected package entries,0high/critical; production audit0. Preserve initial CI39699301268 failure and its fixed-date fixture explanation above, plus initial source/archive and decoded logs.

Final read-only health at 2026-10-22T00:32:27.096Z confirms completed1.6.2/89e693df430571b9371cefad7db1e750ae41fe30/dpl_F3uShagMUnYftappZnbrmSdTf42T, connected database and unchanged20261016010000_rights_identity_evidence; readiness503blocked. No deployment or authentication. OwnPG46511stopped;3synthetic databases, dump and restore evidence retained. Storage/API integration remains unfinished and this foundation is not independently release-ready. All existing clinical/MFA/release/fresh-backup gates remain; October15exception not reused. See SERVICE-ASSESSMENT-REVISION-STORE-EVIDENCE.json for source, checks, log hashes and limits. Next separate tooling patch4.1.12, then structured history integration and retained backlog.
