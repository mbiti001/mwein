# Mwein DHA readiness — current work list

Reviewed: 22 September 2026. This is an engineering readiness review, not DHA certification or a self-attestation score.

## Verified release boundary

- Application: https://mwein-hmis-platform.vercel.app/
- Live source: `a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7`.
- Live migration: `20260923140000_clinical_closure_identity_history` (43 migrations in the released chain).
- Live check at 15:19 UTC: `/api/health` returned HTTP 200, database connected, exact source above; `/api/ready` returned HTTP 503, `blocked`.
- Released verification evidence: 239 unit tests and 28 browser scenarios passed, with type checking and production build. These are automated tests, not signed clinical UAT or independent assessment.
- MFA work was stopped at the user's request. It exists only as uncommitted local changes and has not been deployed or migrated. It is excluded from every completed item below.
- The current working tree's evidence generator would see the draft MFA migration. Do not use that working-tree output as evidence of the live release.
- The 13 internal governance gates are not an official DHA score. Their individual live approval records were not re-read under an administrator session during this review; the public blocked status is the live evidence available.

## Our original ten-part list

| # | Workstream | Current status | Remaining acceptance work | Accountable role |
| --- | --- | --- | --- | --- |
| 1 | Complete patient-visit lifecycle | Implemented and deployed | Clinical sign-off for outpatient, recovered, deceased, referred, against-advice and other outcomes; rehearse partial-service exceptions | Medical director |
| 2 | Safe overdue-visit management | Implemented and deployed | Confirm waiting targets and staff escalation/cancellation procedure; no automatic cancellation is claimed | Clinical operations lead |
| 3 | Reliable patient identity | Implemented and deployed locally | Review identity-correction authority and high-risk approvals; national registry verification and automatic duplicate merging are not implemented | Records officer / DPO |
| 4 | Structured consultation | Implemented and deployed | Clinician UAT, approved medication safety rules, terminology policy and live WHO selection walkthrough | Medical director |
| 5 | Privacy and patient rights | Core workflows deployed; assurance incomplete | Approved DPIA, privacy notices, processor agreements, retention/legal-hold procedures, complete access-audit review and any required patient delivery channel | DPO |
| 6 | Workforce security | Role boundaries and sessions deployed; MFA paused | Agree identity approach, MFA, joiner/mover/leaver and emergency-access controls; independent security assessment | Identity / security owner |
| 7 | Validated exchange gateway | Preparation only; transport disabled | Approved Kenya Core profiles, registry integrations, HIE credentials, consent/provenance, retries/idempotency and validated acknowledgements | Interoperability lead |
| 8 | Public-health reporting | Monthly source summary available; national submission unfinished | Approved notifiable-condition rules, alert review/escalation, IDSR datasets, KHIS mappings, review/approval and acknowledgements | Health records / public-health lead |
| 9 | Operational resilience | Tools and retained Neon recovery branch exist; evidence incomplete | Encrypted independent backup, measured restore drill, external immutable audit retention, monitoring and downtime/incident rehearsals | Operations owner |
| 10 | Certification evidence centre | Register, internal gates and evidence tools exist | Exact scope, named owners, signed documents, evidence links, frozen assessor build, mock assessment and DHA submission | Certification lead |

## Additional work already delivered

- WHO ICD-11: live OAuth/search verified against MMS release `2026-01`; credential and fallback controls tested. A successful connection does not establish approved clinical terminology governance. The complete live clinician selection flow still needs a normal clinical walkthrough.
- Clinician shortage cover: dedicated role can register/check in, capture vitals, consult, collect payment and discharge. Provisioned with no automatic staff assignments. Finance approval and payment reversal remain restricted.
- Privacy: consent lifecycle, identity-verified rights requests, single-use staff-authenticated export and controlled corrections are deployed. Duplicate draft rights endpoints were retired.
- ODPC: supplied MWEIN MEDICAL SERVICES Data Controller certificate was reviewed, valid 22 September 2026–22 September 2028. Original retained outside Git; online registry authentication and any separate processor obligation were not established by that review.

## Next work in order

1. **Freeze the certification scope and evidence index.** Declare the outpatient modules being assessed, unsupported workflows and AI inclusion/exclusion. Name an owner for each requirement. Link every claim to the exact release, test and retained evidence. Do not include paused MFA or unfinished national transports.
2. **Assemble the submission document pack.** Verify organisation/KRA/tax documents, retain the ODPC certificate, complete the system manual and requirements specification, and produce reviewed architecture and data-flow diagrams. Existing operations notes are supporting material, not the complete submission pack.
3. **Complete privacy and infrastructure evidence.** Obtain the approved DPIA, processor terms, privacy/retention policies, hosting-location decision, provider encryption/TLS evidence and key/access ownership records.
4. **Rehearse clinical and operational safety.** Run clinician-led UAT with accountable sign-off, review medication/terminology rules, test load/accessibility/concurrency, and perform a measured backup restoration plus incident/downtime exercise.
5. **Build and validate public-health reporting.** Begin with approved datasets and notifiable-condition rules; do not invent national mappings or mark an unacknowledged submission delivered.
6. **Complete HIE/KHIS/SHA integration acceptance.** Obtain official profiles, sandbox access and relevant contracts/credentials; retain conformance, rejection, retry and acknowledgement evidence before enabling transport.
7. **Independent security review and mock assessment.** Close findings, freeze the laboratory environment and then make only demonstrable self-attestation claims. Workforce MFA remains a separate paused decision.

Items 1–2 are the next useful work we can prepare without resuming MFA or waiting for national integration credentials. Owner signatures, external assessment and regulatory decisions must come from the accountable parties.

## Internal gate checklist still requiring retained approval evidence

Clinical UAT; DPIA/data-processing agreements; independent penetration test; backup/restore drill; workforce MFA (paused); incident response; clinical terminology governance; immutable external audit retention; national integration approvals; public-health reporting; release approval/traceability; AI data governance; AI clinical validation. If AI is excluded, record and enforce that scope decision rather than silently marking its gates approved.

## Official reference check

The [DHA certification portal](https://certification.dha.go.ke/) currently publishes assessment areas of functionality (35%), security/privacy/confidentiality (30%), reporting/public-health alerts (20%) and information exchange/interoperability (15%). These are domain weights, not Mwein's scores. It describes self-attestation, evidence review, a prepared testing environment, laboratory assessment and a DHA decision. Its organisation checklist includes incorporation, KRA PIN and valid tax-compliance records; additional evidence follows the claims made.

The [DHA regulatory guide](https://certification.dha.go.ke/regulatory-guide) identifies the governing instruments and states that gazetted text governs over its summaries. The linked signed framework PDF could not be retrieved during this review, so no unverified clause numbers or pass thresholds are asserted.

## Evidence used

- `DHA_CERTIFICATION_READINESS.md` and `OPERATIONS.md` for the current requirements/evidence gaps.
- `RELEASE-20260922.md` for consolidated clinical/privacy migration and release evidence.
- `WHO-ICD11-CONNECTION.md` for the verified terminology connection and its limits.
- `CLINICIAN-SHORTAGE-COVER.md` for the latest application release and tests.
- Codex tasks “DHA Readiness Review” and “Assess Mwein DHA readiness” for the original list and consolidation history. Their older “not deployed” statements are superseded by the later release evidence above.
- Committed governance/integration source, excluding the paused working-tree MFA edits.
