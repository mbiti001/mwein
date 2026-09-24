# Outpatient acceleration build — 25 September 2026

Status: local engineering increment; not deployed or certification-ready.
Source baseline: `adc0dc447e054da05e29a460bb2573bba9e07121`.

## Reference and scope

Use the public [HosiPoa module directory](https://hosipoa.co.ke/modules/), reviewed for this work, as a capability reference. The user confirmed use of this public material; no private outpatient manual was supplied. It describes registration/check-in, specialist queues, consultation, diagnostics, pharmacy and cashier workflows. It is a product directory, not a detailed implementation specification or a DHA standard. Mwein retains its own implementation and clinical governance.

Mwein already implements the connected outpatient journey. The quick-build approach is to close demonstrable gaps in that journey and retain reproducible evidence before expanding care settings.

| Reference area | Existing Mwein implementation | This increment / next dependency |
|---|---|---|
| Front office and appointments | Registration, check-in, appointments, recalls | Add appointment-list access evidence and no-store responses |
| Consultation | Triage, structured notes, coded diagnoses, problem history, signing | Add problem-list access evidence; retain pending clinician UAT |
| Diagnostics | Laboratory and imaging worklists/results | Existing implementation; clinical acceptance remains required |
| Pharmacy | Prescriptions, supply preview, partial dispensing, stock controls | Add supply-preview access evidence; medication-rule approval remains pending |
| Referrals | Tracked referral lifecycle, attachments and acknowledgement records | Add referral-list access evidence |
| Billing | Invoices, payments and cashier workflows | Existing implementation; live payer integration is a separate dependency |

## Implemented change

The GET handlers for appointments, patient problems, referrals and dispensing previews now await a persisted `CLINICAL_RECORDS_ACCESSED` event before returning data. The event records actor, session, facility and a fixed disclosure context. A count plus SHA-256 fingerprint represents the returned resource IDs without copying patient content, query strings or raw resource IDs into audit metadata. Empty lists are also recorded. Fingerprints describe membership, not immutable copies of clinical content or proof that a user read the screen.

Audit persistence failure prevents disclosure. All success and handled error responses from these four GET handlers carry `Cache-Control: private, no-store`. Existing permission checks and facility filters remain in force. Mutation behavior is unchanged. No schema migration is required.

The audit inventory recognizes the new helper. It remains a lexical triage tool with known false positives and omissions; it is not proof of complete access-audit coverage. The four handlers have behavioral regression tests, and the isolated outpatient rehearsal verifies that their evidence reaches the retained, verified audit chain.

## Verification

Synthetic data only; no production changes or external transmissions.

- `npm test`: 61 files, 257 tests passed, including 18 new disclosure regression tests.
- `npm run lint`: passed.
- `npm run build`: production build passed.
- `npm run test:e2e`: 100 checks passed against isolated PGlite, including migration deployment and verification of the retained audit chain.
- `node scripts/audit-coverage.mjs`: 25 inventoried routes; the four changed routes recognized, five remaining candidate gaps (including previously documented false positives). This is not a clean system-wide audit assertion.
- `git diff --check`: passed.

These are local engineering results, not a frozen release manifest, live deployment evidence, browser accessibility testing or clinical UAT.

## Remaining certification work

This addresses part of APP-02/APP-04 in the [existing implementation backlog](assessment-pack/APP-AUDIT-AND-IMPLEMENTATION-BACKLOG.md), not all of Package B. Reporting and other sensitive endpoints still need their own authorization, disclosure and header review. DPO access, safe restore tooling and reproducible release-evidence generation remain specified engineering work. Clinical UAT, DPIA approval, deployed encryption/recovery/security evidence, accepted reporting mappings and HIE conformance remain external or mixed dependencies.

Continue from the [scope and decision register](assessment-pack/SCOPE-AND-DECISIONS.md). Product parity is not certification. Neither this build nor the public reference closes mandatory DHA criteria. Paused local MFA work is excluded from this checkout.
