# Mwein HMIS parity audit

Audited on 7 September 2026 against the public capability descriptions for [HosiPoa](https://www.hosipoa.co.ke/) and [Easy Clinic](https://www.easyclinic.io/). Marketing claims were used as a product-model baseline; this is not a certification of either system or a clinical UAT sign-off.

## Position now

Mwein has the connected outpatient core: registration, appointments, queueing, triage, consultation, patient history, laboratory, imaging, pharmacy, billing, payments, claims preparation, inventory, procurement, users/roles, audit, operational reporting and visit completion. The current work also adds specialty service points for ANC, MCH/PNC, diabetes, dialysis, cancer, sickle-cell care and walk-ins, plus linked mother/child records and a tracked referral workflow.

Pharmacy and stock are now one role-aware workspace rather than overlapping modules. The operating flow follows the public [Maisha Meds app](https://maishameds.org/app/) model of Manage Inventory, Receive Inventory and History, adapted to Mwein's clinical dispensing and maker-checker controls. Authorized pharmacy staff can dispense, inspect clickable medicine/batch records, correct an erroneous expiry with a mandatory reason, receive approved purchase orders, count and transfer stock, and inspect a store-aware movement ledger. Pharmacy operator, pharmacy manager, inventory clerk and procurement approver duties are distinct; purchase-order and variance maker-checker controls remain enforced.

This matches the strongest shared model in both references: one patient record, one workflow across departments, and charges/stock/results following care instead of being re-entered.

## Remaining work

### Release blockers

- Deploy and exercise the new database migration in a non-production PostgreSQL environment, then run end-to-end tests for specialty assessment, referral, consultation signing, payment and visit closure.
- Complete clinician, nurse, laboratory, pharmacy, cashier and records UAT, including the stated 3–5 minute consultation target and mobile layouts.
- Obtain clinical governance approval for specialty templates, medicine safety rules, referral content and ICD-11/KHIS mappings.
- Configure and certify live SHA, payment and messaging integrations. Current readiness checks and reminder preparation do not constitute live submission or delivery.
- Complete production security, privacy, backup/restore, disaster-recovery, monitoring and penetration-test evidence.

### Major parity gaps

- Inpatient operations: admission, wards/beds, nursing administration, theatre, newborn unit, discharge and morgue.
- Enterprise administration: full accounting, HR, attendance, leave, payroll and statutory deductions.
- Multi-facility control: central catalogue/pricing policy, cross-site analytics, cross-facility stock movement and tenant administration. Movement within a facility is now ledgered by source and destination store.
- Patient engagement: actual SMS/email/WhatsApp delivery, confirmations, recalls, campaigns and a patient portal.
- Broader programmes and specialties: ART, TB, immunisation, dental, optical, nutrition, physiotherapy and gynaecology templates and reports.
- Teleconsultation, configurable workflow/template builder and room/resource scheduling.

### Clinical and commercial depth

- Complete the consultation banner and separately structured multi-complaint capture.
- Add a governed medication interaction and dose-limit knowledge base, renal/hepatic/pregnancy/paediatric rules and severe-allergy hard stops.
- Add pharmacist-recorded FEFO override/substitution, dated multi-payer price history and—after OPD UAT—controlled stand-alone pharmacy sales.
- Replace referral result labels with immutable, versioned result/document links and add secure external exchange/acknowledgement.
- Expand KHIS/MOH reporting from a reviewable monthly source summary to approved mappings, validation and submission workflows.

### Later differentiation

- Custom dashboards and scheduled reports, AI-assisted documentation/analysis, fraud/pilferage analytics and advanced patient engagement automation.

## Repository state

- The specialty/referral feature and the legacy-site consolidation are committed separately so they can be reviewed independently.
- The remote-only legacy overhaul has been merged; local `main` contains the full `origin/main` history and is ready to push after final review.
- The root README declares the PostgreSQL/Next.js application in `platform/` as canonical. The root SQLite application remains only as an explicitly labelled compatibility pilot.
