# System requirements specification — draft

Accountable owner for this workstream: **Edwin Mbiti Chavulimu**, per the user’s instruction of 22 September 2026. Listed lead/reviewer roles describe delivery expertise, not separate accountable ownership.

Internal requirements for the proposed scope. “Implemented” means supporting code/release evidence exists, not that an assessor has accepted it. Evidence references are defined in [the register](EVIDENCE-REGISTER.md); UAT references in [the scenario pack](DEMONSTRATION-AND-UAT.md).

| ID | Requirement and acceptance criterion | Current assessment | Verification |
|---|---|---|---|
| REQ-01 | Restrict patient access and mutations to authorized roles and the current facility; reject cross-facility identifiers without disclosure | Implemented; independent review pending | EV-01, EV-02; UAT-02 |
| REQ-02 | Register/check in a patient without silently merging identities; preserve the reason and provenance of corrections and reversal | Implemented; correction authority approval pending | EV-01; UAT-03 |
| REQ-03 | Capture measured observations without prefilled normal vitals; preserve linkage to the same patient and visit | Implemented | EV-02; UAT-01, UAT-05 |
| REQ-04 | Preserve signed encounter content and use attributable addenda for later changes | Implemented; clinician sign-off pending | EV-01; UAT-01 |
| REQ-05 | Display/order/review diagnostic services with explicit progression and verified results; prevent unresolved in-progress work being silently cancelled by closure | Implemented; service-owner UAT pending | EV-01; UAT-04 |
| REQ-06 | Prescribe and dispense against the correct patient/order with stock provenance and permission checks | Implemented; medication governance pending | EV-01; UAT-06 |
| REQ-07 | Record clinical outcome independently of settlement; retain charges when unstarted services are explicitly cancelled for financial review | Implemented; exceptions approval pending | EV-02; UAT-04 |
| REQ-08 | Require an appropriate cashier shift for cash collection and independent approval; deny reversal/approval to cover clinicians | Implemented | EV-02; UAT-05 |
| REQ-09 | Return WHO terminology with release and identifiers, validate selected values and label local fallback | Connected and tested; normal live walkthrough pending | EV-03; UAT-07 |
| REQ-10 | Support identity-verified rights handling and controlled export; preserve consent and correction provenance | Implemented; DPO policy and delivery approval pending | EV-01; UAT-08 |
| REQ-11 | Audit supported sensitive reads/mutations and verify exported integrity; retain evidence outside the application | Partial: external immutable retention unproven; coverage review pending | EV-07; UAT-09 |
| REQ-12 | Produce reproducible source summaries with defined reporting periods and corrections; support required public-health reporting | Local summaries only; mandated datasets/delivery incomplete | EV-10; UAT-10 |
| REQ-13 | Restore independent backups to a disposable target and demonstrate approved recovery objectives | Tools exist; measured independent drill outstanding | EV-05, EV-08; UAT-11 |
| REQ-14 | Identify exact deployed source and migration, use synthetic assessment data and prevent secret/patient data entering test artifacts | Release traceability available; assessor freeze pending | EV-01, EV-02, EV-11; UAT-12 |
| REQ-15 | Demonstrate workforce identity lifecycle, session revocation, emergency access and required MFA assurance | Role/session controls exist; MFA paused and not claimed | EV-09; UAT-02, UAT-05 |
| REQ-16 | Document hosting, encryption, access, processor terms, transfers and approved retention | Documentary gap | EV-06, EV-08 |
| REQ-17 | Establish measured capacity, concurrency, accessibility and usability targets and verify against representative synthetic workloads | Targets and formal evidence outstanding | EV-12; UAT-13 |
| REQ-18 | Validate scope exclusions and any applicable exchange/AI requirements before attestation | Decision and conformance gap | EV-10, EV-11; UAT-12 |

## Data and interface requirements

Primary records include facility/user/role/session, patient identity and correction history, visits/observations/encounters/addenda, orders/results, prescriptions/dispensations/stock, invoices/payments/receipts/shifts, referrals, consent/rights and audit/governance evidence. The committed Prisma schema is the field-level data dictionary; its digest is in the release manifest. The DPO must approve a retention/disposal schedule by record class; this pack invents no retention period.

Browser requests use application APIs; the server enforces authorization and uses Prisma for PostgreSQL access. WHO diagnosis lookup is an external terminology interface. National transport, AI processing and external identity assurance must not be attested merely because related code/configuration names exist.

No numeric availability, response time, recovery-point or recovery-time promise is approved here. Operations and clinical leadership must record targets before performance and continuity acceptance. All failed safety, disclosure or integrity cases require a defect owner and retest; a test-count total does not close a finding.
