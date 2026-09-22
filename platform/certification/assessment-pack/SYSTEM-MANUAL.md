# System manual — proposed outpatient assessment scope

Draft operator manual for the [baseline release](README.md), to be reviewed against the frozen assessment environment. Screen names follow the workstations; authorized roles determine visibility. Use synthetic patients for demonstrations. A missing button is not evidence that the server rejects an unauthorized request; assess both.

## Access and patient selection

Sign in using an individually assigned account. Confirm the facility and role before opening records. Search for the existing patient and check the displayed identifiers before starting care. Escalate possible duplicates to the authorized identity workflow; do not register another record simply to bypass a match. Sign out when handing over a workstation. Report unexpected access immediately.

Staff administrators use Administration → Staff access to assign authorized roles. Role changes revoke existing sessions; the affected person signs in again. Document authorization and verify resulting permissions. DPO role definition exists in provisioning, but its ordinary staff-assignment UI/API path must be reconciled and demonstrated before claiming complete DPO onboarding. Native MFA is not part of this release claim.

## Registration, triage and consultation

1. Reception registers a new patient only after identity checks, or selects an existing patient and starts the appropriate visit/service workflow.
2. Nursing records actual measured observations against the correct visit. Leave unavailable observations unrecorded and follow the facility escalation procedure; do not invent normal values.
3. The clinician opens the consultation, checks identity, history, allergies and observations, then records the complaint, findings, assessment and plan.
4. Search diagnoses using terms or codes. WHO receives the entered search text, so do not paste identifiers or clinical notes. Review the selected code/title. An outage fallback represents previously recorded facility diagnoses, not proof of a fresh WHO search.
5. Order indicated services/medicines and review the plan before signing. After signing, use the available attributable addendum process rather than replacing the signed record.

## Diagnostics and medicines

Laboratory and imaging staff select the correct queued order, confirm patient/specimen or study details, advance the applicable service status and record/verify results under their permissions. The clinician reviews available verified results. Unavailable or incomplete results require explicit follow-up; do not present them as verified normal findings.

Pharmacy reviews the patient, prescription, instructions and relevant safety information, then records dispensing using the intended stock/batch workflow. Resolve discrepancies with the prescriber. Separate dispensing, stock management and finance permissions apply. Clinical leadership must approve medicine catalogs and safety rules before relying on them operationally.

## Billing, closure and follow-up

Billing reviews the invoice and charges. Cash collection requires the collecting user's own open cashier shift. Confirm the payment result and receipt before retrying a slow request. Reconcile the shift and submit it for an independently authorized finance approver.

The clinician explicitly records the clinical outcome, including referral where appropriate. Sending a referral and recording an outcome must follow the referral workflow. In-progress services cannot be silently cancelled by closing the visit. Explicit cancellation of unstarted work preserves charges for finance review. Clinical closure and financial completion are separate: an unpaid invoice does not erase the clinical outcome, and payment alone does not prove safe clinical discharge. Review pending care and follow-up before completing the encounter.

For overdue work, authorized staff review the queue, investigate the reason and choose a documented action. Do not assume the system automatically cancels unattended visits.

## Clinician shortage cover

An authorized administrator assigns “Clinician — shortage cover” when approved for a staffing shortage. The clinician signs in again and, from Consultation, can select/register a patient, start a visit, take measured vitals, document care, open billing and explicitly discharge. Routine check-in triage routes to the same patient's consultation; specialty workflows may differ.

Cash collection still requires that clinician's own shift. The cover role does not confer reversal, shift approval, payer submission, pharmacy dispensing or administration. Restore the normal Clinician role when cover ends and verify session revocation. Cover does not expire automatically. Record who authorized the cover, start/end times and who removed it in the facility staffing record.

## Privacy, identity and records requests

Use the patient identity correction workflow with a documented reason and authorized review; retain the prior values/provenance and use reversal where appropriate. Do not silently overwrite identity history.

For a rights request, follow Privacy & rights, verify identity under the approved facility procedure, record the request and authorized decision, then use the controlled export/delivery workflow. Single-use export limits do not establish the recipient's identity by themselves. Keep exported records in the protected delivery channel approved by the DPO. A patient-facing deterministic visit summary is distinct from an AI-generated draft; this pack does not include AI operation.

## Failure and downtime

If a save/payment appears to fail, first check whether it completed before repeating it. Escalate ambiguous or inconsistent state with the visit/reference and time, avoiding patient details in ordinary support logs. WHO failure permits the labelled local diagnosis fallback; resolve coding uncertainty with the clinician.

If the service is unavailable, invoke the facility-approved downtime procedure and reconcile records after recovery. That procedure, responders and rehearsal are still required evidence. Engineering backup scripts are not an operator authorization to overwrite production. The readiness endpoint being blocked is a governance signal; it does not automatically prevent the application serving traffic.

## Administration and evidence

Authorized administrators review staff access, governance and operations evidence. Store references to protected artifacts rather than certificates, patient exports or secrets in Git. Review audit exports using the integrity verifier and retain them in the approved external store. The operations manual provides technical recovery procedures: [OPERATIONS.md](../../OPERATIONS.md).
