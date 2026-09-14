# Consultation and Pharmacy Release Checklist

Verified against the supplied consultation/pharmacy specification on 3 September 2026. This is a code-and-schema review, not a clinical UAT sign-off.

Legend: `[x]` implemented, `[~]` partial, `[ ]` missing or requires a product decision.

## Consultation

- [~] Single-screen staged consultation workflow. Notes, diagnosis, investigations, prescription, review and signing share one workstation, but the 3–5 minute target needs timed clinician UAT.
- [x] Patient banner. Name, age/sex, patient number, allergies, visit, triage, phone, coverage, last-visit date, recent diagnoses and the governed longitudinal problem list are available as role-appropriate context. Pharmacy also restores the patient/visit/diagnosis/priority safety header before supply.
- [x] Structured triage and observations.
- [x] Presenting complaint and history. Up to eight complaints are captured separately with validated paired duration values/units, while the overall history retains enforced text limits and legacy-record compatibility.
- [x] General and optional system examination capture.
- [~] Searchable coded diagnosis, diagnosis type and one primary diagnosis. Arbitrary code entry is blocked: the API accepts only a short-lived, facility-bound signed selection returned by the diagnosis search. The build intentionally uses WHO ICD-11 MMS; the supplied specification says ICD-10. Kenyan reporting/interoperability mapping still requires governance approval.
- [x] Laboratory and imaging ordering captures priority and clinical indication, then routes catalogue-backed requests to worklists and billing.
- [x] Prescription transfer to the pharmacy queue and billing synchronization.
- [x] Referral/admission/follow-up. Follow-up and disposition are captured; referrals have a printable document, controlled lifecycle, receiving-provider feedback and are linked to the visit summary.
- [x] Signed encounter locking, audit author/timestamp and visit summary.
- [x] Signed-note addenda are append-only, author/timestamp attributed and audit logged without rewriting the original encounter.

## Pharmacy

- [~] Medicine catalogue. Stable codes, medicine names, prices and active state exist; strength/form/route/pack/minimum-stock/controlled flags are not fully normalized as catalogue fields.
- [~] Structured prescription. Normalized medication concept, generic, strength, form, dose, route, frequency, treatment dates, quantity, instructions, indication, PRN and dose timing are persisted; dose and duration units are not yet separate fields.
- [x] Automatic prescription quantity calculation from structured dose units, administrations per day and duration, with clinician confirmation and an editable final quantity.
- [x] Queue status views separate Awaiting, Partial, Dispensed and Not supplied prescriptions while keeping only actionable prescriptions open for dispensing. The workstation distinguishes a live-stock loading state from a completed no-stock result and refreshes active queues while the tab is visible.
- [x] Queue and review context includes patient, age, weight, allergies, diagnosis, medicine, prescriber, priority, prescription time, payer status, prior supply and live FEFO stock.
- [x] Batch inventory, expiry enforcement, FEFO deduction, no negative stock, stock movements and audit trail.
- [x] Full and cumulative partial dispensing. Outstanding quantity remains on the original prescription and in the pharmacy queue.
- [~] Safety checks. Exact active duplicates are blocked using normalized ingredient, strength, form, route, frequency and overlapping dates; edit, replace and justified override decisions are audited. Same-class and allergy matches warn. Interaction knowledge-base, dose-limit, renal/hepatic, pregnancy/paediatric and severe-allergy hard stops remain incomplete.
- [x] Automatic FEFO batch allocation is visible before supply, retained in the stock ledger and visit summary, and dispensing requires explicit counselling confirmation.
- [x] Every confirmed supply creates an idempotent immutable dispensation with batch lines; network replay cannot deduct stock or bill twice.
- [x] Pharmacy invoice quantities follow cumulative confirmed dispensing, including partial supply; prescribing alone no longer creates a medicine charge.
- [x] Pharmacist FEFO batch override and equivalent-medicine substitution are constrained, require recorded reasons, remain linked to the immutable dispensation and batch ledger, and create dedicated audit events.
- [x] Low-stock/expiry visibility, operations reporting, periodic physical counts and independent variance authorization are implemented.
- [x] Stock exceptions are clickable to the exact medicine/batch; authorized staff can correct an erroneous expiry with a mandatory reason and immutable audit/movement records.
- [x] Goods receipt against approved purchase orders, within-facility transfers and a source/destination-aware stock movement history are available in the unified pharmacy workspace.
- [~] Billing uses immutable invoice line prices; dated multi-payer medicine price history is not implemented.
- [ ] Stand-alone pharmacy sale with prescription-only controls.

## Recommended Order

1. Decide ICD-10 versus ICD-11 mapping/reporting with the clinical and interoperability owner.
2. Approve and connect governed medication-interaction and dose/special-population knowledge sources.
3. Run timed clinician UAT across general and specialty workflows.
4. Defer stand-alone pharmacy sales until the connected OPD workflow passes UAT.

## Verification

- `npm test`: 33 files and 122 tests passed.
- `npm run lint`: TypeScript validation passed.
- `npm run build`: Next.js production build passed.
- `npm run test:e2e`: 29-check isolated outpatient journey passed.
- `npm run test:browser`: 6 authenticated desktop/mobile browser journeys passed.
