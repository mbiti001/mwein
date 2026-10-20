# Visit cancellation

## Staff workflow

Open **Visits** from the sidebar or **Manage visits** on Home. Search by patient name, patient number, visit number or clinic. The list starts with the oldest open visits and supports loading additional pages, including visits that are no longer at the staff member's own service point.

Select **Cancel visit** beside the correct visit. Cancellation is also available beside Home tasks and as **Cancel this visit** in the patient context bar. Selecting a patient directly in Consultation, Triage, Vitals, Billing or Service points updates that context.

The dialog checks the latest clinical and financial state before showing the effects. Review the patient and visit number, choose a reason, explain the circumstances and next step, tick the confirmation, and select **Confirm cancellation**. **Keep visit**, Close and Escape leave the visit unchanged.

Cancellation requires an explicit staff decision. Time spent waiting never cancels a visit automatically. The **Overdue unprocessed visit** reason is accepted only when a waiting/called queue entry exceeds the facility's service-point target; staff must first review attendance.

## What cancellation changes

- Marks the visit Cancelled and removes it from active worklists.
- Closes active queue entries.
- Cancels only unstarted orders in Draft or Requested status.
- Voids the unpaid invoice and cancels its draft claims.
- Marks the linked appointment Cancelled.
- Retains the patient, visit, original notes, measurements, invoice entries, financial history and administrative documents.
- Stores the reason, explanation, named staff member and cancellation timestamp, with a session-bound audit event.

A cancelled visit is not deleted or represented as completed clinical care. Its cancellation is visible in the existing patient history to staff with history access. Staff can open an appropriate new visit if the patient returns.

## When cancellation is blocked

The server blocks cancellation for admitted, referred, discharged, completed or already-cancelled visits; an existing clinical closure; a signed or corrected consultation; a signed clinical document; a service in progress or completed; a pending or confirmed payment; a partially or fully paid invoice; or a claim beyond Draft that has not been cancelled.

Use the existing clinical closure, correction, payment reversal or claims workflow as indicated by the blocker. Completed care is retained. Signed administrative gate passes do not prevent a legitimate cancellation.

SHA benefit/eligibility cancellations require an outcome and verification reference. Urgent or emergency care cannot be cancelled for SHA or other-cover eligibility reasons.

The preview is advisory. The server rechecks the visit and related records within a serializable transaction at confirmation, so a newly signed consultation or changed payment cannot be overridden by an older screen. Conflicts return an actionable error without committing a partial cancellation.

## Access and privacy

The workflow requires the dedicated visit.cancel permission. Reception, Billing, Finance Manager and Facility Administrator retain their existing grants. Clinician, Clinician shortage cover, Nurse and Medical Director gain the same governed workflow. A system-administrator-only account does not gain clinical cancellation rights.

The cancellation worklist and preview disclose operational identity, generic blockers and effect counts. They do not grant access to clinical notes, service names, results or payment details. Requests remain facility-scoped, audited and private/no-store.

## Release

Follow OPERATIONS.md for the controlled release order. Apply migration **20261020120000_frontline_visit_cancellation** before deploying the application. It adds the dedicated permission to existing frontline roles without assigning roles to users, altering credentials or changing clinical records. Bootstrap definitions provide the same grants for a new isolated installation; do not run the full bootstrap against production.

Verify the reception and shortage-cover journeys after release, including a blocked completed-care visit and retained cancellation history. The implementation's automated checks use synthetic patients and an isolated database.
