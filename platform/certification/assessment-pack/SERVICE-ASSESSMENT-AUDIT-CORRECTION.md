# Assessment saved-value audit correction

Scope: service-point assessment saves, on the owner-renamed `codex/mwein-platform`, based on `f4dbc03f2f0b884c14e6de4280a72df6fd8b66f3`. This is engineering evidence, not clinical, legal or regulatory approval. The completed live 1.6.2 release is separate; this batch is not a deployment.

The previous event fingerprint included only the service, template and field names. Different assessment values therefore produced the same `afterHash` argument. The complete chained event hashes were not identical: those also bind time, identity and chain metadata. The route also omitted before-state fingerprints and session attribution.

## Correction contract

- A save computes its before fingerprint from the transaction's observed persisted record, before any writes. First creation fingerprints an explicit absent-record state. The after fingerprint uses the record returned by the database, including validated/derived values, rather than the raw request.
- Both use `assessment-v1:` followed by the SHA-256 hexadecimal digest of canonical UTF-8 JSON. The ordered envelope is `["assessment-v1", facilityId, visitId, recordOrNull]`. A record is `[id, encounterId, servicePoint, templateVersion, data, riskLevel, followUpAtOrNull, updatedById, updatedAt]`. Dates are UTC ISO strings. JSON object keys are recursively sorted lexically; arrays retain order; scalar types, Unicode, null, false, zero, empty strings and missing keys remain distinct. This is the application's versioned format, not a claim of RFC 8785 compliance.
- The success event explicitly binds the authenticated user's facility, user and session. These values are not accepted from the request. Success/audit writes remain inside the existing Serializable transaction. No automatic retry, permission, MFA, facility, lifecycle, template or original-revision checks were relaxed.
- Existing audit events are not rewritten. New events use the versioned format; historical key-name fingerprints cannot retrospectively establish original values. Hashes are neither encryption nor retained assessment snapshots and cannot reconstruct overwritten content. Immutable structured revisions and amendments remain separate work requiring database release safeguards if schema changes are needed.
- GET, browser layouts and printing are unchanged. The existing desktop/tablet/390/320 and print/PDF regressions are retained.

## Verification and limits

The replacement acceptance test failed against the old route, with 39 existing cases passing. Final route/helper cases check canonical ordering, individual value/risk/follow-up changes, false/zero/empty/missing/type distinctions, record/encounter/facility/visit/recorder/timestamp binding, prior-to-next fingerprint continuity, separate-session attribution, and fingerprints of persisted rather than submitted data. Existing denied/failure/stale-state tests remain.

The native fixture independently reconstructs the documented fingerprint format from persisted PostgreSQL rows, checks the actual Session mapping, retains the previous success event byte-for-byte and checks rollback on injected audit failure. Existing first-writer contention, stale editor/signer and SQL final/closure race checks remain. The SQL state fixtures do not constitute clinical signing/discharge approval or general load testing. Full audit export/chain checks remain in the fixture.

Retained failures: the new regression's expected RED result; the helper's initial type mismatch for nullable legacy risk values (corrected without treating null as an asserted risk); Windows `Start-Process -Wait` waiting for the PostgreSQL descendant (interrupted the owned launcher, then used process-specific waiting); and the first native fingerprint reconstruction incorrectly parsing offset-free raw SQL timestamps as local Nairobi time. Read-only diagnostic reconstruction exactly matched the stored digest with UTC interpretation. The test now explicitly interprets the schema's UTC timestamp values and builds the stale signer revision the same way. The failed fixture database/log and subsequent fresh database are retained. No assertion weakening or test retries.

Final source/build/test results and hashes are recorded in the companion evidence JSON and workflow log after verification. No historical data repair, production migration, seed, credential changes, real-patient workflow or external messages are part of this batch. The October 15 backup exception is not reused. All future release review, fresh-backup and clinical readiness gates remain.

## References and next work

Primary engineering references checked for this batch: [Node.js hashing API](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options) and [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html). No new clinical rules or current-law claims were introduced; prior WHO, Kenya MoH and HosiPoa reference limitations remain documented in the assessment audit.

Next: immutable structured assessment revisions/amendments and unsaved navigation/reload protection, followed by payment/dispensing/supply session attribution, changed-payload stock replay, diagnostic offered/accepted handover, pharmacy clarification, cashier and follow-up ownership. The separate visit-cancellation PR #11 is preserved; it has its own permission-migration and release gates and is not merged by this assessment batch.
