# HosiPoa and AfyaDynamics workflow alignment

Reviewed 24 October 2026 following the owner's question about visible improvements and workflow alignment. This review changes the next work priority; it is not an assertion that a full cross-role workflow audit or redesign has already been completed.

## Finding

The existing backlog used HosiPoa's module scope and Danphe's diagnostic workflow as reference material. The reference review did not explicitly map AfyaDynamics. Recent batches concentrated on prescribing integrity, assessment history and save recovery. Those are necessary supporting controls, but their test counts do not demonstrate that the staff-facing journey follows either reference.

Mwein does have a saved-record patient journey and department handoffs. In the current source, PatientJourney is rendered by ClinicalApp only when encounter.write is present. Its fields summarise registration, triage, consultation, diagnostics, medicines, clinical discharge and financial completion. That clinician-facing summary is not evidence of a consistent next-action view at reception, laboratory, pharmacy and cashier. Avoid both claiming that Mwein lacks all workflow and claiming that module coverage proves alignment.

## Reference principles and next verification

| Reference principle | Existing evidence | Gap or next acceptance evidence |
|---|---|---|
| One patient record follows the encounter | Visit-linked clinical, order and saved-journey records; October 16 handoff/discharge evidence | Trace a synthetic patient across separate authorised department sessions, without re-keying identity or losing encounter context. |
| Role-focused queues direct the next action | Existing workstations and task reconciliation | Establish the same patient/visit identity, current queue, responsible role, pending reason and permitted next action at every handoff. Inspect actual screens before choosing changes. |
| Investigations return to consultation | Verified-results panel and diagnostic review worklist | Retained backlog includes explicit offered/accepted handover and inactive-owner recovery. Do not treat opening a result as clinical acknowledgement. |
| Prescription, dispensing and stock stay linked | Existing prescribing and dispensing paths | Trace partial supply, shortage and return-for-clarification ownership; distinguish current capability from unresolved exceptions. |
| Charges and cashier follow provided care | Existing billing task and separate clinical closure | Audit cashier reconciliation/refunds and balances. Preserve independent clinical discharge and financial settlement; the reference diagram is not a new rule to withhold care. |
| Saved information is readable and attributable | Compact entry/saved layouts, history and recovery work | Verify the same grouped blue/white presentation on desktop, tablet, phone and print across the journey, including missing values and failures. |

## Next coherent batch

Before another isolated enhancement, audit the ordinary outpatient journey from reception/check-in through triage, consultation, investigation/results review, prescription/dispensing, cashier and follow-up/discharge. Use synthetic data and role-specific sessions. Produce a source-bound current-versus-target map with screenshots, then implement the first demonstrated handoff/next-action gap. Include optional/parallel investigations and return loops; do not enforce a rigid linear clinical pathway. Keep authorisation, facility isolation, audited disclosure, failed refreshes, duplicate requests and cross-patient late responses in acceptance checks.

This supersedes the earlier ordering that would automatically continue structured amendments or reload recovery next. Preserve those remaining tasks; do not duplicate completed patient-journey, storage, history or exact-request recovery work.

## Sources and limits

- [HosiPoa module directory](https://www.hosipoa.co.ke/modules/), primary indexed content checked 24 October: reception/check-in/queues, consultation, diagnostics, pharmacy and cashier scope.
- [HosiPoa reception-to-pharmacy workflow](https://www.hosipoa.co.ke/blog/from-reception-to-pharmacy-how-hosipoa-can-help-improve-hospital-workflow/), primary indexed article dated 30 September 2026 and checked 24 October: encounter continuity between departments and facility-dependent pathways. Direct article fetch returned cache miss; indexed text was available.
- [AfyaDynamics public site](https://dev.afyadynamics.com/), primary public page checked 24 October: registration, triage, consultation, laboratory request, prescription and billing share a record; dispensing connects to inventory. Main https://afyadynamics.com/ returned 403. No authenticated product demo or proprietary screen-level behaviour was inspected.

These are public product descriptions, not clinical protocols, independently verified certification, integration contracts or acceptance of Mwein. No vendor integration, communication, clinical standard or new production approval is inferred. WHO/MoH/DHA acceptance and existing release safeguards remain separate.
