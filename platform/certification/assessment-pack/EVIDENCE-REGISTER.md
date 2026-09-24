# Evidence register

“Available” identifies an artifact, not approval. Engineering release notes are developer-authored records; retain original runner outputs before independent assessment. Edwin Mbiti Chavulimu is accountable for every row; specialist reviewers, custody locations and due dates remain to be recorded. The owner-role column identifies the discipline involved. Protected artifact links belong in the controlled evidence store, not public source control.

| ID | Evidence and available reference | Status / limitation | Owner role |
|---|---|---|---|
| EV-01 | [Unified release](../RELEASE-20260922.md); committed schema/routes/tests; [manifest](RELEASE-MANIFEST.json) | Earlier release notes describe predecessors. Current release: [25 September deployment](../DEPLOYMENT-20260925.md), source 1d1e5ea, 47 migrations. Engineering evidence only | Release owner |
| EV-02 | [Clinician cover release and test record](../CLINICIAN-SHORTAGE-COVER.md); `e2e/clinician-cover.spec.ts`, `e2e/clinical-closure-identity.spec.ts` at baseline | 239 unit/28 browser scenarios reported passing; collect full immutable output; clinician acceptance pending | Medical director + release owner |
| EV-03 | [WHO connection evidence](../WHO-ICD11-CONNECTION.md) | Production generic-query check passed; live clinician selection and coding approval pending | Medical director |
| EV-04 | ODPC certificate, held outside Git | Both supplied certificates visually inspected: controller serial 27289, valid 2026-09-22–2028-09-22; processor serial 27735, valid 2026-09-24–2028-09-24; MWEIN MEDICAL SERVICES, ID 112-9801-11EB. [Hashes and review](../DHA-READINESS-20260925.md). Registry and applicant acceptance not independently verified | DPO |
| EV-05 | [Recovery branch record](../RELEASE-20260922.md) | Provider recovery point exists; not independent backup or restore evidence | Operations owner |
| EV-06 | DPIA, notices, processor agreements, rights/retention/legal-hold procedures | [Version 2 DPIA](PRIVACY-DPIA-AND-PROCEDURES-DRAFT.md) and [decision schedules](PRIVACY-DECISION-SCHEDULES.md) prepared; owner adopts MOH/Kenyan-law basis. Signed assessment, class-specific periods and executed terms outstanding | DPO |
| EV-07 | `scripts/verify-audit-export.mjs`, `scripts/audit-coverage.mjs`; [operations guidance](../../OPERATIONS.md) | 68-route source-bound inventory passed at current release; independent assurance, verified export and immutable custody evidence pending | Compliance owner |
| EV-08 | Hosting/database/backup architecture and recovery controls | [SSD/recovery workbook](INFRASTRUCTURE-AND-RECOVERY-WORKBOOK.md): Charles custodian, away from computer per owner. Encryption, separate-site copy, provider controls, actual backup/restore and monitoring evidence pending | Operations owner |
| EV-09 | Role/session code and bootstrap definitions at baseline | Mandatory MFA and governed DPO assignment deployed; witnessed joiner/mover/leaver/recovery and independent access review pending | Identity/security owner |
| EV-10 | Local reporting and integration readiness code | Approved datasets, IDSR/KHIS workflow, national conformance/acknowledgements and SHA authority incomplete | Health records + interoperability owners |
| EV-11 | [Scope](SCOPE-AND-DECISIONS.md), [requirements](SYSTEM-REQUIREMENTS.md), [manual](SYSTEM-MANUAL.md), [architecture](ARCHITECTURE-AND-DATA-FLOWS.md) | Drafts prepared; scope approval, signed framework mapping and frozen assessor environment pending | Compliance + release owners |
| EV-12 | [UAT scenario pack](DEMONSTRATION-AND-UAT.md) | Scenarios prepared; human results, performance/accessibility evidence and independent security assessment absent | Medical director + security owner |
| EV-13 | Applicable original business registration and applicant authorization | Business-search evidence available as EV-14; taxpayer documents now EV-15/EV-16. Remaining applicant-category requirements pending | Edwin / facility leadership |
| EV-14 | [Business Registration Service official search](BUSINESS-REGISTRATION-EVIDENCE.md) | Received, full page visually inspected and SHA-256 recorded; MWEIN MEDICAL SERVICES / BN-VDCAPY53 / Edwin Mbiti Chavulimu, proprietor; registry particulars as at 18 September 2026. No independent registry validation | Edwin |
| EV-15 | [Tax Compliance Certificate review](TAX-EVIDENCE-REVIEW.md) | Edwin named; dated 13 November 2025, stated valid through 12 November 2026; received and visually reviewed, live status not verified | Edwin |
| EV-16 | [KRA PIN Certificate review](TAX-EVIDENCE-REVIEW.md) | Edwin named; certificate date 2 February 2015; PIN matches EV-15; received and visually reviewed, live status not verified | Edwin |

Certificate SHA-256 recorded during earlier inspection: `c8b29ea5a5b489df4fce051509aabb5703a38d23a4d8550abe9b61610a224cf7`. No certificate file is copied into this pack. Both controller and processor certificates are now reviewed; registration does not establish contractual obligations or DHA certification.

## Evidence custody record template

For each submitted artifact record: evidence ID; title/version; related internal requirement and actual DHA clause; named owner; protected repository URI; SHA-256; creation/collection date; source environment and release; validity/expiry; reviewer; approval status/date; limitations; next review date. Use “not provided” for missing records. Never enter invented signatories or dates.

The baseline source contains useful tests including `src/lib/clinical-closure.test.ts`, `src/lib/privacy.test.ts`, `src/lib/icd11.test.ts`, `src/lib/patient-identity.test.ts`, `src/lib/billing.test.ts`, `e2e/privacy-rights.spec.ts` and `e2e/authenticated-workflows.spec.ts`. Test source demonstrates intended checks; retained execution output establishes a particular run. Neither substitutes for external approval.


## Fresh execution evidence and ownership update

[Technical results from 22 September](EXECUTION-STATUS.md) now retain passing 239-unit/28-browser results, type and migration checks, visual verification and live release probes. These supersede the need to rely solely on earlier developer release summaries for these checks; human UAT and external assessment remain outstanding. Edwin Mbiti Chavulimu is now accountable across all workstreams; Charles Karani remains the data-protection contact. CR13/business-search evidence is received and visually inspected as EV-14; assessment approvals remain pending.

## Current preparation record

[25 September review handoff](PRIVACY-OPERATIONS-HANDOFF-20260925.md) identifies owner decisions, completed drafting and the concrete evidence still required. Earlier dated execution records remain historical; they are not the current release baseline.
