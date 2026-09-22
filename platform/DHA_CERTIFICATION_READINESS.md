# Mwein DHA certification readiness register

Status date: 22 September 2026

Current review: [deployed status and ordered work list](certification/DHA-READINESS-SNAPSHOT-20260922.md). Live release `a5e19d3` is healthy but its readiness probe remains blocked. Clinical priorities 1–4, core privacy workflows, WHO ICD-11 linkage and the clinician shortage-cover role are deployed. MFA is paused by user instruction; its uncommitted local changes are not certification evidence.

This register maps the supported `platform/` application to the Kenya Digital Health Certification Framework. A status of **implemented** means repository evidence exists; it does not substitute for deployment evidence, clinical approval or DHA laboratory confirmation.

## Authoritative sources

- [DHA certification programme](https://certification.dha.go.ke/)
- [Kenya Digital Health Certification Framework](https://admin.dha.go.ke/uploads/DHA_Kenya_Digital_Health_Certification_Framework_Signed_20cad2c0a1.pdf)
- [Digital Health (Health Information Management Procedures) Regulations, 2025](https://admin.dha.go.ke/uploads/The_Digital_Health_Health_Information_Management_Procedures_Regulations_2025_09301b40fa.pdf)
- [Digital Health (Data Exchange Component) Regulations, 2025](https://admin.dha.go.ke/uploads/The_Digital_Health_Data_Exchange_Component_Regulations_2025_9d6f2c2e5f.pdf)
- [Kenya Core FHIR Implementation Guide](https://fhir.dha.go.ke/ig/index.html)

## Submission blockers

| Requirement | Current evidence | Status | Next action | Owner |
| --- | --- | --- | --- | --- |
| ODPC registration | MWEIN MEDICAL SERVICES data-controller certificate, serial 27289, valid 22 September 2026–22 September 2028; visually reviewed from the supplied PDF | Controller certificate available | Retain the original in the approved evidence store; assess any separately applicable processor registration | Data protection officer |
| System DPIA | Governance gate exists; no approved report is retained here | Blocked externally | Complete a Mwein-specific DPIA covering hosting, integrations, support access and AI processing | Data protection officer |
| Encryption at rest | Production documentation requires it; provider and key-management evidence absent | Evidence required | Select the production data stores, document encryption and key lifecycle, and capture provider evidence | Security/operations owner |
| Encryption in transit | HTTPS and database TLS are required by configuration; deployed TLS evidence absent | Evidence required | Capture edge, database and integration TLS configuration and renewal controls | Security/operations owner |

Do not submit self-attestation until all four rows have retained, reviewable evidence.

## Certification criteria

| Area | Weight | Current position | Principal gaps | Repository evidence |
| --- | ---: | --- | --- | --- |
| Functionality | 35% | Strong outpatient EMR baseline | Clinical approval of terminology bindings (WHO ICD-11 API is connected); growth/MCH completeness; adverse-event capture; exchangeable summary and ePrescription; only claim workflows demonstrable in the laboratory | `src/components/ClinicalApp.tsx`, clinical workstations, `prisma/schema.prisma`, automated tests |
| Security, privacy and confidentiality | 30% | Partial implementation | Production OIDC/MFA; complete data-access audit coverage; emergency access; patient-facing delivery channel; penetration test; deployed encryption, retention and recovery evidence | `src/lib/auth.ts`, `src/lib/audit.ts`, `src/lib/privacy.ts`, `src/app/api/patients/[id]/privacy/route.ts`, `OPERATIONS.md` |
| Reporting and public-health alerts | 20% | Monthly source summary only | Immediate notifiable-disease alerts; weekly/monthly IDSR; public-health events; approved KHIS mappings; submission acknowledgement and retry | `src/app/api/reports/moh-monthly/route.ts` |
| Information exchange and interoperability | 15% | Preparation only | Kenya Core FHIR API; HIE authentication; client/facility/worker/terminology/product registries; conformance validation; consent-aware exchange | `src/lib/integrations.ts`, SHA preparation modules |

## Ordered delivery plan

### 1. Evidence and scope control

- [ ] Declare the product category and exact modules included in certification.
- [ ] Decide whether AI visit summaries are disabled in the certification build or included in the DPIA and clinical validation.
- [ ] Create an evidence identifier and accountable owner for every row in this register.
- [ ] Produce the system manual, software requirements specification, architecture and data-flow diagrams.

### 2. Privacy and security baseline

- [x] Inspect the supplied ODPC data-controller registration certificate and record its validity.
- [ ] Complete and approve the system DPIA; confirm whether separate processor registration applies.
- [ ] Workforce identity and MFA — paused by user instruction; no MFA deployment or enrollment is claimed. Confirm the chosen approach before resuming.
- [ ] Implement controlled, justified and audited emergency access.
- [ ] Audit patient searches, clinical-history reads, exports, disclosures and other patient-data access.
- [x] Add consent-version, purpose, evidence and withdrawal workflows.
- [x] Add tracked data-access, correction, portable-export and disclosure-request lifecycles.
- [x] Generate a one-time authenticated portable export, complete its verified request and retain its audit evidence.
- [x] Apply controlled demographic corrections only through a verified, in-review correction request.
- [ ] Add a patient-facing delivery channel if exports must be delivered without an authorised staff session.
- [ ] Demonstrate encrypted backups, an independent restore drill and immutable audit retention.
- [ ] Complete vulnerability assessment and independent penetration testing.

### 3. Public-health reporting

- [ ] Implement notifiable-condition rules using an approved terminology release.
- [ ] Add immediate alert review and escalation.
- [ ] Produce weekly and monthly IDSR datasets.
- [ ] Add KHIS dataset versioning, validation, approval, submission status and acknowledgements.

### 4. Kenya HIE interoperability

- [ ] Implement and validate Kenya Core FHIR R4 resources required by the supported workflows.
- [ ] Integrate client, facility, health-worker, terminology and product registries.
- [ ] Make the clinical summary and electronic prescription exchangeable through the HIE.
- [ ] Add consent enforcement, provenance, retries, idempotency and reconciliation for exchange.
- [ ] Retain validator output and sandbox conformance results for every supported transaction.

### 5. Clinical closure and laboratory rehearsal

- [ ] Obtain clinical approval for medication-safety rules and terminology mappings.
- [ ] Add or explicitly exclude unsupported ancillary workflows from the certification scope.
- [ ] Run clinical UAT, accessibility, load, concurrency, recovery and security scenarios.
- [x] Maintain an automated isolated synthetic-data test environment and browser/API scenarios.
- [ ] Freeze the assessor testing environment and clinician demonstration scripts for the declared certification scope.
- [ ] Freeze a release, retain its dependency/build/test evidence and conduct a mock DHA assessment.

## Evidence rules

1. Configuration placeholders are not evidence that a control operates.
2. Every approval must identify the approver, date, evidence reference and review date.
3. Evidence containing patient data must not be committed to this repository.
4. Security reports, certificates and signed policies should be retained in the approved access-controlled evidence store.
5. A feature is claimed in self-attestation only when it can be reproduced in the fixed laboratory build.

## Reviewed ODPC evidence

The supplied `MWEIN MEDICAL SERVICES Registration Certificate.pdf` was visually reviewed on 22 September 2026. It names MWEIN MEDICAL SERVICES as a Data Controller, identification `112-9801-11EB`, serial `27289`, valid 22 September 2026 through 22 September 2028. File SHA-256: `c8b29ea5a5b489df4fce051509aabb5703a38d23a4d8550abe9b61610a224cf7`. The original is retained outside Git. This review does not claim online registry verification, processor registration, or DHA certification.


## Assessment preparation pack — 22 September 2026

The [draft assessment pack](certification/assessment-pack/README.md) now provides the proposed outpatient scope, accountable-role register, requirements, system manual, architecture/data flows, evidence inventory, synthetic UAT protocol and submission/sign-off checklist. Its release manifest is derived from deployed commit `a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7`, excluding paused MFA work. Edwin is accountable across all workstreams; signed approvals, official clause mapping and external evidence remain outstanding. Drafting this pack does not approve a governance gate or change production.


## App audit and implementation queue

See the [22 September app audit](certification/assessment-pack/APP-AUDIT-AND-IMPLEMENTATION-BACKLOG.md) for DPO access, disclosure audit, reporting authorization, response headers, restore safety and reproducible evidence packages. These are specified for implementation, not claimed fixed. CR13, ODPC and Edwin’s tax documents are indexed; individual/innovator checklist and fee treatment remain unverified.
