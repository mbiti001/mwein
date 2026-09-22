# Individual/innovator application — evidence gap review

22 September 2026. Accountable owner: Edwin Mbiti Chavulimu. User reports registration as an individual and innovator. This changes the applicant-document review; it does not by itself change the app's clinical scope or establish fee exemption.

## Verification boundary

The official [DHA certification page](https://certification.dha.go.ke/) was checked today. It describes two fees, with the application amount depending on applicant type and laboratory fees on system category. No automatic full waiver was verified. It separately lists identity/enrolment evidence for innovators/students and company/tax evidence for organizations. The public wording groups innovators with students; the exact requirement for a non-student individual must be established from the account-specific checklist or DHA clarification. Do not claim student status without evidence.

The application portal opened at sign-in and subsequently reached an email-verification challenge. Registration, generated checklist, invoice/waiver, selected classification and submission stage have not yet been inspected in the authenticated account. A zero application fee, if shown, must be distinguished from a waiver of laboratory testing. Do not assume that registration equals submission or certification.

The portal identifies ODPC registration, a completed DPIA, encryption at rest and encryption in transit as submission prerequisites. Our evidence for those controls is assessed below. Account-specific requirements govern the final checklist.

## What we have and what remains

| Area | Available now | Missing / not verified |
|---|---|---|
| Applicant identity/category | User reports individual/innovator account; Edwin named accountable owner | Account-specific applicant name/category, national-ID evidence and any applicable eligibility/enrolment evidence |
| Fees | User expects free certification | Account-specific application amount and separate lab fee/waiver decision; no waiver evidence in pack |
| Tax evidence | Edwin’s KRA PIN certificate and TCC received; matching taxpayer details; TCC stated valid through 12 November 2026 | Live KRA verification and account-specific acceptance; see [tax review](TAX-EVIDENCE-REVIEW.md) |
| Business relationship | CR13/official search: MWEIN MEDICAL SERVICES, BN-VDCAPY53, Edwin proprietor | Record individual developer/applicant versus facility/controller roles accurately in application |
| ODPC | MWEIN MEDICAL SERVICES controller certificate reviewed; dates and checksum indexed | Confirm applicability to the individual applicant and actual controller/processor arrangements; do not relabel certificate as Edwin's personal registration |
| DPIA | Application-specific assessment/risk/procedures draft | Completed assessment, actual processing/transfer details, consultation, residual-risk decisions, date and approval |
| Encryption and keys | HTTPS live health check; Vercel/Neon architecture; deployment metadata | Project-specific at-rest standard, key custody, database/backup encryption and transport evidence covering every link |
| Clinical product | Registration, vitals, consultation, diagnostics, dispensing, billing, closure and shortage cover implemented | Clinician UAT and medication/terminology/exception approvals |
| Engineering verification | Fresh 239 unit tests, 28 browser scenarios, type check and 43 migrations passed; outputs retained | Human acceptance, capacity/accessibility evidence and independent assessment |
| WHO ICD-11 | Production connection and generic coded search verified | Normal clinician selection walkthrough and terminology governance |
| Product documents | Manual, requirements, architecture/data flows, scope and evidence register drafted | Final claimed scope, actual DHA clause/checklist mapping and approved upload versions |
| Workforce/privacy controls | Roles, sessions, consent/rights and audit tooling | DPO onboarding-path defect, reporting access review, lifecycle/emergency-access evidence; MFA paused |
| Infrastructure/continuity | Provider recovery branch, backup/restore tooling and drill workbook | Independent retained backup, measured restore, immutable audit custody, monitoring and incident/downtime rehearsal |
| Public-health reporting | Local monthly source summary | Approved datasets/case definitions, notification/correction workflow and KHIS/IDSR delivery evidence |
| National interoperability | Preparation code and WHO terminology connection | Approved profiles/registries, sandbox conformance, transport controls and acknowledgements |
| Assessor environment | Disposable local synthetic fixture demonstrated | Stable assessor URL/version, controlled accounts/reset, endpoint matrix and authorized testing declarations |

## Applicant-document adjustment

The business search remains useful supporting evidence of Edwin's relationship to Mwein. Company incorporation/KRA/tax documents are no longer treated as automatic blockers for the reported individual route; their applicability is awaiting the generated checklist. Conversely, the CR13 does not substitute for personal identification or eligibility evidence requested by that route. The actual facility/controller and hosting arrangements remain relevant even when the developer applies individually.

## Order to close gaps

1. Inspect the authenticated account: applicant/category, system classification, generated documents, application fee and separate lab-waiver terms.
2. Finish the DPIA and collect project-specific encryption/key/hosting evidence; clarify ODPC coverage and applicant/controller roles.
3. Approve scope and document versions; resolve DPO/reporting-access findings; execute clinician UAT and recovery/security evidence work. MFA remains paused unless the user changes that instruction.
4. Close reporting/exchange criteria applicable to the selected system category; freeze the assessor environment and assemble the required uploads.

No submission, fee payment, attestation, account change or production change was made by this review. We have a working tested product and substantial draft evidence, but not a complete verified application pack.
