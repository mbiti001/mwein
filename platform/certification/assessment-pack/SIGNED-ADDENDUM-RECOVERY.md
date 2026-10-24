# Signed-note addendum recovery

Engineering batch, 24 October 2026. Continues the interrupted narrative-idempotence work after the verified structured-history viewer. No clinical policy, signing gate or structured amendment authority is introduced.

## Saved effect and authorization

POST `/api/encounters/[id]/addenda` requires a UUID retry key, existing `encounter.write` permission, password/MFA checks and a signed encounter in the authenticated facility. A nullable unique database column preserves legacy rows without inventing historical keys. The new record and original actor/session/facility audit receipt commit together. Serializable transactions retry only known aborted conflicts and unique-insert races, at most three attempts. Network/unknown failures are not automatically replayed.

An exact key, encounter, author, trimmed reason and trimmed narrative returns the original record only when its persisted-value audit fingerprint exists for that actor/facility/encounter. A renewed authenticated session of that same actor may confirm the original receipt; the original session attribution is retained. Changed values, another actor or encounter, missing evidence, and non-signed/foreign encounters fail closed without disclosing the stored narrative. Replays create no additional success event. Unique-key contention converges to one record and one original audit event. These controls do not make existing narrative rows immutable against arbitrary database administrators.

Retry keys are excluded from visit-summary reads and governed patient exports. Service-point narrative disclosure already selects explicit public fields. Other read authorization and disclosure-audit gates are unchanged.

## Browser and presentation

The form freezes both key and submitted values during an outstanding or ambiguous request. Repeated submit events cannot start a second request. An explicit unchanged retry is available after a lost response, server failure or malformed/mismatched success. A definite first-attempt validation/authorization rejection leaves the text editable. Once an outcome is ambiguous, a later failure never silently replaces the key.

Confirmed records are deduplicated by ID, and only the matching encounter is updated. Unmount and patient changes ignore late responses. Workspace/back navigation asks before losing unsaved or unconfirmed work; reload uses the browser's native warning. Deliberately leaving still loses the in-memory request key: there is no patient-data browser cache or cross-reload recovery claim. The warning directs the user to review saved records before entering another addendum. Structured amendment review and comprehensive retained recovery remain separate backlog.

Blue/white reason and narrative columns match the saved layout, with phone stacking. Original author/time and explicit missing labels remain visible. Print includes saved addenda and excludes the editor, uncertainty messages and unsaved text. Print-media checks are not physical-printer approval.

## Verification and release boundary

Route tests cover permission/facility scope, invalid/missing keys, changed values/author/encounter, receipt failure, atomic audit failure, bounded retries and no automatic transport retry. Native disposable PostgreSQL checks cover audit rollback, current projection and retained-history preservation, same-actor renewed-session confirmation, other permitted actor denial, exact duplicate replay, concurrent same-key convergence and summary key exclusion. Mandatory-MFA denial is exercised through the existing native fixture. Browser scenarios cover lost/malformed responses, editable definite rejection, exact retries, double submit, cancelled/accepted navigation and stale response isolation, plus desktop/tablet/390/320 and saved print. Exact results/source/build are in the companion evidence record.

Migration `20261023010000_encounter_addendum_idempotency` is NOT applied to production. Older clients without a key will receive validation failure after cutover and must reload. Any later release requires a fresh backup and restore evidence, migration/application cutover coordination, and all existing MFA, clinical readiness, security and DHA gates. The October 15 backup-reference exception does not apply. Prior authorized 1.6.2 release is already complete; this batch does not deploy, seed, change credentials or exercise real patient workflows.

## Sources checked

- [PostgreSQL complete-transaction retry guidance](https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html): known aborted transactions must restart the full decision/write sequence; unique errors require care.
- [Next.js route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route), also read from installed 16.4.3 documentation. Prisma remains the repository's pinned 6.12.0; the current Prisma transaction documentation now describes version 8 and was not used to change this version's APIs.
- [WHO Digital Adaptation Kits](https://www.who.int/publications/m/item/who-digital-accelerator-kits): workflow/data/functional design context only.
- [HosiPoa module reference](https://hosipoa.co.ke/modules/) timed out and [Kenya MoH portal](https://portal.health.go.ke/) returned 502 during this run. Prior references remain context, not newly verified standards or approvals. No new clinical or regulatory requirement is inferred.

Dependency gate correction: the complete audit identified high-severity [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), affecting Zod below 4.6.6. Updated the exact Zod dependency from 4.5.4 to 4.6.7 (one installed package changed); no force update, API schema relaxation or exploitability claim. The original failed audit and pre-patch test runs remain distinct from final patched-source verification.
