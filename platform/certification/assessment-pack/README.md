# Mwein HMIS — DHA assessment preparation pack

Review pack updated 25 September 2026 • Proposed scope, awaiting accountable review

This is a review pack, not an application submission, certification, signed policy or clinical go-live approval. It describes the deployed outpatient release and records the evidence still needed. Edwin Mbiti Chavulimu is the user-designated accountable owner across all workstreams. The supplied official search identifies him as proprietor of MWEIN MEDICAL SERVICES. Charles Karani remains the designated data-protection contact. Approvals and final protected evidence-store references remain pending.

## Read in this order

1. [Scope and decisions](SCOPE-AND-DECISIONS.md): module claims, exclusions and accountable owner register.
2. [System requirements](SYSTEM-REQUIREMENTS.md): internal requirement IDs and acceptance criteria.
3. [System manual](SYSTEM-MANUAL.md): role-based operating procedures and failure handling.
4. [Architecture and data flows](ARCHITECTURE-AND-DATA-FLOWS.md): system boundaries, storage and external transfers.
5. [Evidence register](EVIDENCE-REGISTER.md): what exists, its limits and what must be collected.
6. [Demonstration and UAT](DEMONSTRATION-AND-UAT.md): executable assessment scenarios and result template.
7. [Document checklist and sign-off](DOCUMENT-CHECKLIST-AND-SIGNOFF.md): missing documents, submission preparation and approvals.
8. [Release manifest](RELEASE-MANIFEST.json): source-derived migration inventory and file hashes.

## Baseline and limits

Current application source: `1d1e5eac30296dfbeb1684361379eeff2a252c1c`; deployment `dpl_nmBvuxSsjJbvGxgjDR7MG5eaEbcE`; [published application](https://mwein-hmis-platform.vercel.app/). Latest migration `20260924130000_workforce_mfa` (47 migrations). [Deployment record](../DEPLOYMENT-20260925.md) records successful exact-source verification, health 200 and readiness 503/blocked. Mandatory MFA is deployed. Local verification passed 361 unit tests and 100 outpatient checks; GitHub platform/legacy verification including browser workflows passed. These remain engineering evidence, not signed clinical UAT or independent assessment.

The older RELEASE-MANIFEST.json and technical-evidence-20260922 directory are historical artifacts for their named source. Do not relabel them as the current release. The [privacy/operations handoff](PRIVACY-OPERATIONS-HANDOFF-20260925.md), revised DPIA and SSD workbook are the latest review drafts.

## Regulatory reference and mapping rule

The [official DHA certification portal](https://certification.dha.go.ke/) describes self-attestation, evidence review, test-environment preparation, laboratory testing and a certification decision. Its evidence requirements depend on claimed capabilities. The [regulatory guide](https://certification.dha.go.ke/regulatory-guide) provides further context. References were checked on 22 September 2026; confirm the application-specific list before submission.

All `REQ-`, `EV-`, `UAT-` and `DEC-` identifiers here are internal. No signed-framework clause mapping or pass threshold is asserted. The signed framework was not retrieved during this review. The compliance owner must attach the applicable authoritative version and map each claim to its actual requirement before attestation.

## Next work in order

1. Edwin, now accountable for all workstreams, records the final scope/AI decision and arranges the required specialist reviews.
2. Compliance collects corporate documents; DPO completes privacy evidence; operations produces infrastructure and recovery evidence.
3. Medical director runs and signs the synthetic UAT pack; identity owner witnesses deployed MFA enrollment/recovery and records operational evidence.
4. Reporting and interoperability owners complete any capabilities DHA requires for the chosen classification; exclusions cannot waive mandatory requirements.
5. Freeze an isolated assessor environment, retain independent assessment results and assemble the portal-specific submission.


## Work on items 1–4

See the [execution status and fresh test evidence](EXECUTION-STATUS.md), [leadership record](LEADERSHIP-AND-APPOINTMENT-RECORD.md), [privacy/DPIA draft](PRIVACY-DPIA-AND-PROCEDURES-DRAFT.md), [infrastructure/recovery workbook](INFRASTRUCTURE-AND-RECOVERY-WORKBOOK.md) and [reporting/interoperability implementation register](REPORTING-AND-INTEROPERABILITY-IMPLEMENTATION-REGISTER.md).


Leadership evidence is now received: [business-search review and checksum](BUSINESS-REGISTRATION-EVIDENCE.md). See the [updated all-workstream ownership record](LEADERSHIP-AND-APPOINTMENT-RECORD.md).


## Applicant route update

The user reports an individual/innovator DHA registration. See the [individual/innovator gap review](INDIVIDUAL-INNOVATOR-GAP-REVIEW.md) for the revised applicant-document checklist and fee-verification limits. Organizational tax/incorporation documents are conditional on the actual application requirements, not assumed individual-route blockers.


Tax evidence received: [Edwin’s KRA PIN and Tax Compliance Certificate review](TAX-EVIDENCE-REVIEW.md). Both were visually inspected; the TCC states validity through 12 November 2026. Live verification and DHA acceptance remain pending.


## Implementation backlog

The [app audit and implementation backlog](APP-AUDIT-AND-IMPLEMENTATION-BACKLOG.md) records confirmed code gaps, five implementation-ready packages, acceptance tests and external dependencies. It distinguishes scanner false positives and describes historical implementation gaps; consult the current readiness review for later closures.

Reporting follow-up: [APP-08 / APP-09 requirements and acceptance plan](REPORTING-IDSR-REQUIREMENTS.md), including the facility and receiving-service inputs still needed.

## Latest operational observation

The [25 September follow-up](technical-evidence-20260925-operations/README.md) records public release `83fdd61`, a documentation-only successor to the application baseline above, and fresh TLS/provider evidence. Backup preparation is tested; the physical SSD restore remains pending.
