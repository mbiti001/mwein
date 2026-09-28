# DHA readiness review — 25 September 2026

Status: engineering controls substantially implemented; DHA readiness remains unapproved. This assessment uses the consolidated source, the existing assessment pack and the official DHA portal checked on 25 September 2026. It does not assert a certification percentage or that drafted documents have been signed. The dated deployment record will identify the exact published source and runtime observations.

## Submission prerequisites

The [official DHA certification portal](https://certification.dha.go.ke/) lists ODPC registration, a completed system DPIA, encryption at rest with standard/key management, and encryption in transit as submission prerequisites. Applicant-specific statutory documents and later laboratory requirements must also be satisfied. These are evidence requirements, not controls that become approved merely because an environment setting is present.

| Requirement | Evidence reviewed | What remains / accountable owner |
|---|---|---|
| ODPC registration | Both supplied PDFs visually reviewed on 25 September 2026: MWEIN MEDICAL SERVICES, identification 112-9801-11EB. Controller serial 27289: 22 September 2026–22 September 2028. Processor serial 27735: 24 September 2026–24 September 2028 | Evidence supplied for both roles. DPO: retain originals in the private submission pack; online registry authenticity and applicant-specific acceptance have not been independently verified |
| System DPIA and privacy arrangements | [Version 2 DPIA and operating pack](assessment-pack/PRIVACY-OPERATIONS-HANDOFF-20260925.md), consent and rights workflows; owner adopts MOH retention guidance and Kenyan law | DPO/leadership: completed approved Mwein-specific DPIA, processor agreements, retention and incident procedures, actual hosting/AI processing scope |
| Encryption at rest and key management | Hosting evidence workbook; database/backup tools exist | Operations/security: provider/database/backup encryption standard, key/access custody, regions, retention, and supporting records |
| Encryption in transit | Live HTTPS application; source requires secure configuration | Operations/security: retained edge, database and integration TLS evidence, certificate lifecycle and all supported connection paths |
| Applicant evidence and classification | Business-registration, ODPC and tax documents indexed in existing pack | Edwin: confirm applicant/category checklist in the DHA portal, current documents and fee treatment; no fee exemption assumed |

## Technical and assessment exit conditions

| Area | Implemented capability | Remaining evidence or functionality |
|---|---|---|
| Workforce identity | Mandatory MFA, enrollment, one-use recovery, protected replacement/admin recovery; no optional security navigation | Individual enrollment, approved joiner/leaver/recovery process and witnessed acceptance; no factors enrolled on behalf of staff |
| Privacy and access audit | DPO management; audited clinical/operational reads; private/no-store responses; source-bound route inventory | Independent branch-level assurance, access review, external immutable audit custody/retention, and operational monitoring |
| Clinical/finance acceptance | Registration through triage, consultation, diagnostics, medicines, payments, referral and explicit clinical closure; synthetic regression tests | Qualified clinician, nurse, laboratory, pharmacy, cashier and records UAT; medication/terminology approvals; accessibility/capacity targets and closed findings |
| Security and recovery | Role/tenant boundaries, restore target/checksum/system-identity safeguards, backup/audit tooling | Independent penetration test and remediation; SSD chosen with Charles as custodian away from computer, but encryption/separate-site custody unverified; witnessed restore with approved/measured RPO/RTO and downtime/incident rehearsal still required |
| Reporting and IDSR | Local aggregate drafts, independent review, frozen revisions/corrections; local surveillance case/event register and manual-notification records | Busia/Nambale recipient and escalation protocol, responsible surveillance officer, approved dictionaries/forms/case definitions, KHIS organisation-unit mapping, weekly-return calendar/design, automated escalation and genuine submission acknowledgements |
| National exchange | Preparation helper corrected; no production national transmission claim | Accepted Kenya Core profiles/identifiers, registries, authorised sandbox/credentials, mapping validation, consent/provenance, transport/retry/idempotency and retained conformance results |
| Release and scope | Committed-source evidence collector, exact release/migration health verification; all current 47 migrations | Frozen synthetic assessor URL/accounts, approved category/module list, signed manual/SRS/architecture, approved AI applicability, and laboratory demonstration/evidence pack |

Edwin is the accountable owner across the existing workstreams; specialist evidence still needs the relevant qualified reviewer. Busia County, Nambale Subcounty and MFL 31749 remain user-supplied context. The MFL code is not a substitute for a verified KHIS organisation-unit identifier.

## Recommended completion order

1. Complete the DPIA and retain actual hosting/TLS/encryption/key/backup records; reconcile the applicant-specific portal checklist.
2. Arrange qualified clinical/finance UAT, independent security assessment and witnessed recovery/downtime testing. Retain results and close findings.
3. Obtain county reporting dictionaries, case definitions, routing and KHIS mapping; finish required weekly/urgent reporting and acknowledgement workflows against those inputs.
4. Obtain authorised HIE/SHA sandbox contracts, profiles and registry access; implement and verify accepted exchanges.
5. Freeze the assessment release and evidence pack; complete self-attestation/document review and laboratory testing through the official programme.

Publishing the app does not approve these gates. The readiness probe must continue to report blocked until the actual required configuration and approval evidence are complete. Do not replace missing evidence with placeholder approvals.

## ODPC evidence register

Read-only visual inspection of both original PDFs; certificate images and originals remain outside Git and deployment. These registrations do not certify the HMIS itself.

| Role | Original filename | SHA-256 |
|---|---|---|
| Controller | MWEIN MEDICAL SERVICES Registration Certificate.pdf | `c8b29ea5a5b489df4fce051509aabb5703a38d23a4d8550abe9b61610a224cf7` |
| Processor | MWEIN MEDICAL SERVICES Registration Certificate (1).pdf | `5e46770ecc01ebcb0753a1561731c4464a366e4bba0864779abfa45b0fb0e410` |

Release verification is recorded in [the 25 September deployment record](DEPLOYMENT-20260925.md).
