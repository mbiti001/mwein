# Demonstration and clinical UAT protocol

Accountable owner for this workstream: **Edwin Mbiti Chavulimu**, per the user’s instruction of 22 September 2026. Listed lead/reviewer roles describe delivery expertise, not separate accountable ownership.

Status: planned, not executed as part of this pack. Use an isolated synthetic environment frozen to the baseline or an explicitly approved successor. Never use real patients to fill an empty production queue for a demonstration. Give assessors individual least-privilege accounts through a protected channel; never put passwords in this document.

Record prerequisites, test data, release/migration pair, actual result, timestamp, tester, screenshot/log reference, defects and retest result for every case. Review all screenshots for identifiers/secrets before sharing.

| ID | Scenario and steps | Expected evidence / pass condition | Lead |
|---|---|---|---|
| UAT-01 | Existing-patient check-in → measured vitals → consultation → order/diagnosis → sign → addendum → explicit discharge | Same patient/visit throughout; no invented vitals; signed original retained; outcome and follow-up visible | Clinician + nurse |
| UAT-02 | Sign in as different roles; attempt forbidden API action and cross-facility record access; revoke/change access and retry old session | Server denies unauthorized access without record disclosure; old session rejected; approved roles retain intended functions | Security + administrator |
| UAT-03 | Detect possible duplicate; correct identity with reason; review prior values; reverse authorized correction | No automatic merge; full provenance and consistent history | Registration + DPO |
| UAT-04 | Close with pending/in-progress services; explicitly cancel an unstarted service; test referral and unpaid outcome | In-progress safeguards hold; charges retained for review; referral requirements enforced; clinical and financial states distinct | Medical director |
| UAT-05 | Assign shortage cover → fresh login → start visit from consultation → blank vitals → care → own-shift payment → discharge; try reversal/shift approval; remove cover | Correct workflow succeeds; extra finance actions denied; no pharmacy/admin powers; role removal revokes session | Clinician + finance + administrator |
| UAT-06 | Prescribe → dispense correct patient/order/batch → reconcile stock; attempt inconsistent or unauthorized action | Prescription/dispensation/stock provenance agrees; invalid actions rejected; medicine rules reviewed | Prescriber + pharmacy |
| UAT-07 | Search a generic WHO term, select and save; check release/URI; simulate outage in isolated environment; try altered selection | Valid provenance retained; altered selection rejected; labelled facility fallback; no patient identifiers sent | Clinician + terminology owner |
| UAT-08 | Consent and rights request → identity check → authorized decision → export → replay download; review correction history | Authorized single-use flow; repeat access denied as designed; approved delivery and request evidence retained | DPO |
| UAT-09 | Read representative sensitive records, perform changes, export audit, verify integrity and test tampered copy | Covered reads/mutations attributable; tamper detected; coverage gaps documented; custody receipt retained | Compliance + security |
| UAT-10 | Reconcile a fixed synthetic monthly dataset with source visits, include correction/boundary dates, review notifiable-event handling | Accurate defined local totals; missing IDSR/KHIS delivery remains explicit gap, never a simulated production acknowledgement | Health records officer |
| UAT-11 | Take encrypted independent backup, restore to disposable target, verify counts/representative records, rehearse downtime reconciliation | Measured recovery meets approved RPO/RTO; evidence of independent custody; no production overwrite | Operations + clinical lead |
| UAT-12 | Verify frozen release/migrations, synthetic fixtures, application routes and selected scope exclusions | Source/health match; no unpublished MFA included; AI boundary evidenced; national transport not falsely claimed; all included functions listed | Release + compliance |
| UAT-13 | Test representative concurrent workflows, keyboard navigation, labels/errors and session expiry during work | Meets pre-agreed capacity/usability/accessibility criteria; no lost/duplicated clinical or payment state; findings recorded | QA + clinicians |

## Acceptance record

For each case fill: actual result **not run**; evidence URI **TBA**; tester **TBA**; date **TBA**; defects **TBA**; disposition **pending**; reviewer **TBA**. Engineering tests previously passing do not prefill these fields.

Before testing, the medical director defines unacceptable clinical failure conditions; security defines disclosure/integrity stop conditions; operations agrees measurable service/recovery targets. Block acceptance on unresolved serious safety or confidentiality defects. Retest fixes against the exact approved release and update the manifest if source changes.

At completion, attach a signed results matrix, issue register and retest evidence. Obtain separate clinical, finance, privacy, security and operations acceptance; do not treat one developer's signature as approval for all disciplines.
