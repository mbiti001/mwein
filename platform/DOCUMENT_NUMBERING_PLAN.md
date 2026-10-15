# Mwein document numbering — version 1.2.0

Implemented for new clinic documents, purchase orders and goods receipts. This is an engineering convention requested by the owner, not a regulator-prescribed numbering standard or clinical approval.

| Document | Example |
|---|---|
| Sick sheet | MMS-SICK-2026-000001 |
| Maternity form | MMS-MATERNITY-2026-000001 |
| Goods delivery note | MMS-DELIVERY-2026-000001 |
| Gate pass | MMS-GATE-2026-000001 |
| Purchase order | MMS-PO-2026-000001 |
| Goods receipt | MMS-GRN-2026-000001 |

The prefix comes from the authenticated facility. Each facility, document type and calendar year has its own server-managed counter, using the facility timezone. Numbers have at least six sequence digits and expand without truncation. UUIDs remain internal identities. Existing patient, visit, payment and referral references retain their established formats; visit summaries show the existing visit number.

## Allocation and corrections

Permission and facility checks precede allocation. The counter, saved document and audit event commit together in a serializable transaction, with bounded retries for serialization/uniqueness conflicts. Failed transactions do not consume a number. Issued references cannot be edited, reassigned or recycled; the system does not promise gap-free numbering. A clinic document receives its reference when first saved as a draft. A reference alone does not mean signed, approved or issued.

New clinic creation/correction requests carry an opaque retry key and an actor-bound normalized request fingerprint. Replaying the same request returns the original saved document and records a replay audit. Changed details or a different actor are rejected. Concurrent requests cannot create duplicate documents for one key. Legacy API clients may omit the optional key, but then have no exact-retry guarantee; the current interface always supplies it. Purchase orders and receipts use their mandatory transaction keys and stored request fingerprints. Historical orders without a fingerprint cannot be accepted as verified retries.

A correction receives its own serial, revision and link to the original reference. The signed original's number, payload, signature and content hash remain unchanged. Historical UUID-based references remain visible and searchable in full; no cosmetic renumbering or truncated alias changes existing copies or evidence. New database protections freeze draft identities and retry evidence too.

## Saved and printed presentation

Saved clinic registers label document reference, patient/record, status and revision separately. Detail and print views share related-field columns; optional blank sections are omitted and meaningful unknown values are retained. The correction panel identifies the original document reference. Shared letterheads label the reference explicitly. The print filename uses the document reference.

An uncertain clinic creation/correction response locks the submitted details and offers an exact retry. If saving succeeds but the register refresh fails, the confirmed document stays open with a refresh notice. Recovery is held in the current mounted workspace; the navigation warning is not durable crash/reload recovery. That broader recovery work remains in the pipeline.

## Validation and release boundary

Synthetic checks cover simultaneous same-key and distinct-key saves, all clinic types, signing/corrections, legacy reference/hash preservation, cross-facility and role denials, changed actor/payload rejection, audit-failure rollback, stock/receipt atomicity, and draft identity constraints. Browser checks cover desktop/tablet/phone widths, lost responses and matching PDF layouts. Physical printer acceptance remains external.

Version 1.2.0 also retains the earlier diagnostic responsibility/review work. Deployment requires a fresh verified backup and both migrations: 20261015210000_diagnostic_review and 20261016001000_clinic_document_numbering. Preserve the source/version ledger and independent readiness gates.

The active branch is codex/mwein-platform. The former branch was renamed through GitHub; historical release evidence retains its original branch. Automatic Git deployment of this branch is disabled because the current Vercel preview and production database environment targets overlap. Use the controlled exact-source release process; separate preview database configuration remains queued.

Technical sources: [Prisma transaction isolation and retries](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions) and [Vercel branch deployment controls](https://vercel.com/docs/project-configuration/git-configuration). No clinical or legal requirement is inferred from these technical sources.
