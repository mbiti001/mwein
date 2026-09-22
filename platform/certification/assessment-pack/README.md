# Mwein HMIS — DHA assessment preparation pack

Draft 1 • 22 September 2026 • Proposed scope, awaiting accountable review

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

Application source: `a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7`; deployment `dpl_7FW4ub563CBkcojpxEc8biEEvhci`; [published application](https://mwein-hmis-platform.vercel.app/). Latest migration: `20260923140000_clinical_closure_identity_history` (43 migration files). The previously recorded 22 September 15:19 UTC observation reported health 200 and readiness 503/blocked. Fresh follow-up probes are retained in EXECUTION-STATUS.md; no count of approved live gates is claimed.

The release record reports 239 unit tests, 28 browser scenarios, type checking and production build passing. These checks have now also been reproduced from the isolated deployed source; see EXECUTION-STATUS.md. These are engineering results, not clinician UAT, independent security testing or laboratory assessment. Source checks for this pack use the exact deployed commit. Local paused MFA files are excluded from the manifest and all implementation claims.

## Regulatory reference and mapping rule

The [official DHA certification portal](https://certification.dha.go.ke/) describes self-attestation, evidence review, test-environment preparation, laboratory testing and a certification decision. Its evidence requirements depend on claimed capabilities. The [regulatory guide](https://certification.dha.go.ke/regulatory-guide) provides further context. References were checked on 22 September 2026; confirm the application-specific list before submission.

All `REQ-`, `EV-`, `UAT-` and `DEC-` identifiers here are internal. No signed-framework clause mapping or pass threshold is asserted. The signed framework was not retrieved during this review. The compliance owner must attach the applicable authoritative version and map each claim to its actual requirement before attestation.

## Next work in order

1. Edwin, now accountable for all workstreams, records the final scope/AI decision and arranges the required specialist reviews.
2. Compliance collects corporate documents; DPO completes privacy evidence; operations produces infrastructure and recovery evidence.
3. Medical director runs and signs the synthetic UAT pack; identity owner records the unresolved MFA requirement without restarting the paused implementation.
4. Reporting and interoperability owners complete any capabilities DHA requires for the chosen classification; exclusions cannot waive mandatory requirements.
5. Freeze an isolated assessor environment, retain independent assessment results and assemble the portal-specific submission.


## Work on items 1–4

See the [execution status and fresh test evidence](EXECUTION-STATUS.md), [leadership record](LEADERSHIP-AND-APPOINTMENT-RECORD.md), [privacy/DPIA draft](PRIVACY-DPIA-AND-PROCEDURES-DRAFT.md), [infrastructure/recovery workbook](INFRASTRUCTURE-AND-RECOVERY-WORKBOOK.md) and [reporting/interoperability implementation register](REPORTING-AND-INTEROPERABILITY-IMPLEMENTATION-REGISTER.md).


Leadership evidence is now received: [business-search review and checksum](BUSINESS-REGISTRATION-EVIDENCE.md). See the [updated all-workstream ownership record](LEADERSHIP-AND-APPOINTMENT-RECORD.md).


## Applicant route update

The user reports an individual/innovator DHA registration. See the [individual/innovator gap review](INDIVIDUAL-INNOVATOR-GAP-REVIEW.md) for the revised applicant-document checklist and fee-verification limits. Organizational tax/incorporation documents are conditional on the actual application requirements, not assumed individual-route blockers.


Tax evidence received: [Edwin’s KRA PIN and Tax Compliance Certificate review](TAX-EVIDENCE-REVIEW.md). Both were visually inspected; the TCC states validity through 12 November 2026. Live verification and DHA acceptance remain pending.


## Implementation backlog

The [app audit and implementation backlog](APP-AUDIT-AND-IMPLEMENTATION-BACKLOG.md) records confirmed code gaps, five implementation-ready packages, acceptance tests and external dependencies. It distinguishes scanner false positives and excludes paused MFA work.
