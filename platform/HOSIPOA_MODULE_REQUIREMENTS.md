# Additional module requirements — 15 October 2026

Reference: [HosiPoa module directory](https://www.hosipoa.co.ke/modules/), reviewed 15 October 2026. This supplements existing Mwein requirements. Source descriptions identify scope; the acceptance conditions below are Mwein engineering proposals, not claims about the reference product or clinical approval.

## Scope and implementation order

| Area | Existing Mwein foundation | Additional acceptance work |
| --- | --- | --- |
| Reception | Registry, appointments, queues, referrals | Rehearse returning-patient check-in and referral closure; prove reminder delivery after consent checks. |
| Cashier | Invoices, payments, cashier shifts | Rehearse receipt reprints, refunds, discharge clearance and department/insurance reconciliation with independent review. |
| Consultation | Triage, notes, specialty service points | Validate dental, optical, nutrition, physiotherapy and gynaecology pathways with named clinical owners. |
| Laboratory | Orders, specimens, verification, reports | Demonstrate OP/IP routing, configurable ranges and traceable reagent consumption/transfers. |
| Pharmacy | Prescriptions, dispensing, batch stock | Validate discharge supply and till summaries; keep standalone sales behind the existing outpatient assurance dependency. |
| Inpatient | Clinic admission foundation | Implement wards/beds, transfers, nursing tasks, theatre and newborn workflows; prevent double allocation and require discharge reconciliation. |
| Supply | Suppliers, approvals, receipts, counts, transfers | Add batch expiry reporting; verify purchase-order and goods-receipt printable records against immutable posted transactions. |
| Workforce | Staff identities and roles | Model attendance, leave approval, objectives and restricted personnel cases separately from account administration. |
| ART/TB | Specialty framework | Add governed programme enrolment, follow-up and approved reporting mappings. |
| ANC/PNC | Assessments and mother/child links | Rehearse longitudinal visit plans and overdue follow-up with clinical owners. |
| Immunisation | Patient and care records | Add approved schedule versioning, administration records and coverage denominators. |
| Morgue | No dedicated workflow verified | Define identity, custody, storage and authorised release before implementation. |

These are source-inspection observations, not a full operational certification. Existing work must be verified against its current implementation before being marked complete. Live integrations and MOH mappings require their own specifications and validation; a public module directory does not establish them.

## First delivery: batch expiry report

Accessible in Pharmacy → Expiry report to users with `inventory.view`, using the existing facility-scoped, audited supply read. Shows active batches with positive stock, a medicine/code/batch search, all-store or individual-store balances and separate expired, upcoming 30-day, upcoming 90-day and all-stock views. Rows are ordered by expiry, with invalid dates flagged for investigation.

Acceptance:

- Expiry at or before the snapshot instant is expired, matching dispensing; upcoming windows include their endpoints and exclude expired stock.
- A store filter uses its location ledger rather than the facility batch total; zero and invalid quantities are excluded.
- Expired stock remains visible for action. The report does not dispense, adjust, write off or transfer stock.
- Loading and failure states do not present an empty report as successful. Refresh records a new snapshot time.
- Date display uses Africa/Nairobi. Existing expiry semantics are retained pending any separately approved policy change.
- No new patient data, export path, permission or database migration is introduced.

## Next delivery candidates

1. Review printable supplier receipt and order evidence, including partial receipt and cancellation cases.
2. Validate cashier reconciliation and refund journeys with finance staff.
3. Specify inpatient ward/bed state transitions and permissions before extending admission.
4. Agree programme templates and reporting definitions with clinical owners.

Preserve the release gates in OPERATIONS.md and existing clinical governance requirements. Passing code checks does not replace staff UAT or authorise patient use.

## Verification — 15 October 2026

- `npm test -- --maxWorkers=2`: all 407 tests passed across 87 files. The restore-drill fixture now launches synthetic PostgreSQL tools through Node on Windows and Unix, retaining real subprocesses and the production restore entry point. It checks source/target command order and prevents restore when the live identities match.
- `npm run build`: production build and TypeScript passed.
- The production-mode isolated outpatient runner passed all 100 API/database checks, including migrations and mandatory MFA. Its Next.js and Prisma launch commands, and the Playwright server environment configuration, now work without Unix shell assumptions.
- Interactive browser verification used synthetic stock in the isolated database: expired, 10-day and 60-day batches, all-stock view, two-store quantities, search, empty results and refreshed snapshot. A simulated server outage removed stale rows and showed the connection error. Browser inspection also identified and corrected the shared style hiding the report heading/refresh control, and separated the medicine code onto its own line.
- Browser verification was interactive; the complete Playwright browser suite was not run in this session. No production database was used.
