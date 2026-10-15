# Patient journey: engineering evidence and DHA handover

Reviewed 16 October 2026. Candidate work complements the other agent's rights-verification and national-integration preparation. This is local workflow engineering, not clinical approval, DHA certification or evidence of a live HIE connection. Version/source/build evidence belongs in the release ledger and workflow log.

## Implemented local journey

| Stage | Saved evidence and next action | Safeguard |
| --- | --- | --- |
| Registration | Search existing identity, capture permitted demographics/consents, retain attributable corrections. | Duplicate/replay checks, facility isolation and role-scoped disclosure remain in place. |
| Check-in | Open the visit and its real service task. Existing emergency and clinician-cover paths remain available. | Financial eligibility does not block emergency care; no invented triage record for direct-to-clinician paths. |
| Triage | Record observations and priority; hand over to consultation. | The patient journey shows a recorded assessment only when one exists. |
| Consultation | Save assessment, diagnosis and plan; request investigations or medicines. | Draft and signed states remain distinct. Corrected signed records retain their validity. |
| Investigations | Laboratory and imaging tasks can proceed concurrently. Verified results or documented cancellation resolve their own tasks. | Serializable transactions retry conflicts; the last resolved diagnostic creates at most one active consultation task. Existing critical-result communication and verification gates remain. |
| Pharmacy | Partial supply retains pharmacy work. Finishing supply checks the remaining diagnostic and consultation work. | It cannot skip unfinished clinical work, turn an admission into an outpatient visit or reopen a closed visit. Existing stock, counselling and exact-retry controls remain. |
| Clinical discharge | Read an audited current-order review, document outcome and handover, explicitly cancel only reviewed unstarted orders. | Stale reviews and in-progress services block closure. Exact actor-bound retries recover the original closure. Failure to retain its audit rolls back all changes. Payment remains independent. |
| Billing completion | Retain one billing task after clinical discharge, including an administrative alert for a missing invoice. | Final completion requires clinical closure, resolved orders and financial cover under the existing policy. Same-actor retries do not create a second completion. |

The interface uses existing compact blue-and-white field groups for entry and saved discharge records. Attribution, time, missing-value labels and outstanding work remain visible. Opening a later workspace no longer puts completion checkmarks on earlier stages. A clinician's current-patient panel derives progress from authorised saved records, with no new clinical disclosure to reception or other departments.

## DHA integration handover: keep separate state and evidence

The [DHA integration scenarios](https://hie-docs.dha.go.ke/docs/scenarios/overview) distinguish outpatient claim submission from inpatient claim discharge, and describe registry identity, coverage and scenario-specific consent. The local visit ID, recorded treatment consent and clinical closure must not be presented as national identifiers, verified HIE authorisation or a submitted claim. Integration ownership stays with the agent preparing DHA controls. No endpoint was activated in this batch.

The [DHA Shared Health Record lifecycle](https://hie-docs.dha.go.ke/docs/sharedHealthRecord/gettingStarted/intro) describes visit-bound consent, practitioner attribution, FHIR encounter references and an external visit-close response which may still require OTP confirmation. Engineering follow-up must distinguish requested external closure from confirmed closure. Preserve an independently retryable integration state; do not roll back a valid local discharge because a remote service is unavailable, and do not label remote closure confirmed merely because a local clinician signed. Confirm this design with the integration owner and DHA test environment before implementation.

| Local transition | Evidence needed before calling it HIE-ready |
| --- | --- |
| Register/check in | Actual CR/FR/HWR mappings, facility-bound credentials and sandbox identity/coverage response handling. |
| Access a national record | Real visit-bound consent evidence, refusal/expiry handling, applicable representative authority and minimum permitted disclosure. Local consent alone is insufficient. |
| Exchange the encounter | Validated terminology, FHIR resource references, security labels, attributable submission and read-back/rejection evidence. |
| Discharge/end visit | Verified national visit reference, actual external close/OTP outcome, stale-token and delayed-response recovery. Keep clinical closure, SHR closure and claim settlement distinct. |
| Submit/settle claim | Actual scenario-specific authorisation, cover, billing lines and verified provider response. Preserve current draft-only/readiness gates. |

The [DHA go-live guide](https://hie-docs.dha.go.ke/docs/goLive) requires development testing, UAT, formal certification and production credentials. Local synthetic test results cover none of those external approvals by themselves. The main agent retains the broader certification map; this document supplies patient-journey evidence and boundary cases for that map. Do not solicit OTPs, send consent messages, contact third parties or access real patient records as part of this local verification.

## Test evidence

- `scripts/e2e-outpatient.mjs`: existing registration, triage, clinical assessment, investigation, dispensing, payment, referral, emergency and closure regression coverage.
- `scripts/e2e-patient-journey.mjs`: isolated synthetic database; early pharmacy finish, simultaneous diagnostic results, imaging cancellation, partial medicine at signature, changed discharge orders, audit rollback, concurrent exact discharge/complete retries and unpaid closure.
- `src/lib/visit-handoff.test.ts`: status precedence, preserved admissions/closed visits, facility predicates and bounded transaction retries.
- `src/app/api/visits/[id]/discharge/route.test.ts`: current permission, facility isolation, audited private disclosure, stale review, billing retention and actor-bound replay.
- `e2e/patient-journey.spec.ts`: unavailable/stale reviews, retained entries, lost response, exact retry, desktop/tablet/phone sizing, attribution and printed saved summary.

Supporting design references: [WHO Primary Care Checklist](https://www.who.int/publications/m/item/primary-care-checklist), [WHO continuity and coordination](https://www.who.int/publications/i/item/9789241514033), [Kenya MoH standards portal](https://www.health.go.ke/guidelines-standards-and-policies-portal), and [HosiPoa modules](https://www.hosipoa.co.ke/modules/). They inform continuity and module coverage; this batch introduces no diagnostic thresholds or substitute clinical standards. Inpatient bed, nursing and ward workflows still require their governed specifications and validation.
