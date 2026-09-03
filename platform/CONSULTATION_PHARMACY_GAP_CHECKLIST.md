# Consultation and Pharmacy Release Checklist

Verified against the supplied consultation/pharmacy specification on 3 September 2026. This is a code-and-schema review, not a clinical UAT sign-off.

Legend: `[x]` implemented, `[~]` partial, `[ ]` missing or requires a product decision.

## Consultation

- [~] Single-screen staged consultation workflow. Notes, diagnosis, investigations, prescription, review and signing share one workstation, but the 3–5 minute target needs timed clinician UAT.
- [~] Patient banner. Name, age/sex, patient number, allergies, visit and triage context are present; phone, payer, chronic-condition summary and last-visit date are not all shown in the consultation banner.
- [x] Structured triage and observations.
- [~] Presenting complaint and history. Text limits are enforced, but multiple separately structured complaints with duration units are not yet supported.
- [x] General and optional system examination capture.
- [~] Searchable coded diagnosis, diagnosis type and one primary diagnosis. The build intentionally uses WHO ICD-11 MMS; the supplied specification says ICD-10. Confirm the Kenyan reporting/interoperability requirement before changing the coding system.
- [~] Laboratory and imaging ordering. Catalogue selection, specimen defaults and worklists exist; priority and clinical indication are not captured per investigation.
- [x] Prescription transfer to the pharmacy queue and billing synchronization.
- [~] Referral/admission/follow-up. Disposition and follow-up are captured, but a full referral document/workflow is not implemented.
- [x] Signed encounter locking, audit author/timestamp and visit summary.
- [ ] Addendum workflow for a signed note.

## Pharmacy

- [~] Medicine catalogue. Stable codes, medicine names, prices and active state exist; strength/form/route/pack/minimum-stock/controlled flags are not fully normalized as catalogue fields.
- [~] Structured prescription. Medicine, dose, route, frequency, duration, quantity and instructions exist; dose unit, duration unit, PRN and indication are not separate fields.
- [ ] Automatic prescription quantity calculation and clinician confirmation.
- [~] Queue status views. Awaiting and partial prescriptions remain actionable, but four explicit Awaiting/Partial/Dispensed/Cancelled tabs are not present.
- [~] Queue card context. Patient, medicine, quantity and allergy information exist; prescriber, available stock, payer status and prescription time are incomplete.
- [x] Batch inventory, expiry enforcement, FEFO deduction, no negative stock, stock movements and audit trail.
- [x] Full and cumulative partial dispensing. Outstanding quantity remains on the original prescription and in the pharmacy queue.
- [~] Safety checks. Stock, expiry, active-formulary and allergy visibility exist; severe-allergy hard stop, duplicate ingredient, pregnancy/paediatric warnings and configurable formulary checks remain incomplete.
- [ ] Pharmacist-selected batch, substitution with reason, and explicit counselling confirmation.
- [~] Low-stock/expiry visibility and operations reporting exist; periodic physical counts and variance authorization need a dedicated workflow.
- [~] Billing uses immutable invoice line prices; dated multi-payer medicine price history is not implemented.
- [ ] Stand-alone pharmacy sale with prescription-only controls.

## Recommended Order

1. Add pharmacist safety/dispense fields: counselling, substitution reason, and explicit batch traceability.
2. Complete the pharmacy queue context and four status tabs.
3. Add structured prescription frequency/duration and safe quantity calculation.
4. Complete investigation priority/indication fields.
5. Add signed-note addenda.
6. Complete the consultation banner and structured multiple complaints.
7. Decide ICD-10 versus ICD-11 mapping/reporting with the clinical and interoperability owner.
8. Defer stand-alone pharmacy sales until the connected OPD workflow passes UAT.

## Verification

- `npm test -- --reporter=dot`: 40 tests passed.
- `npm run lint`: TypeScript validation passed.
- `npm run build`: Next.js production build passed.
