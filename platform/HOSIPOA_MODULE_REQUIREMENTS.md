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

1. Complete staff UAT of printed supplier receipt and order evidence on the facility's physical printers and with representative large orders.
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

## Second delivery: purchase orders and goods receipt notes

Accessible in Pharmacy → Supply documents with `inventory.view`. The register shows the latest 100 purchase orders and 100 goods receipts for the signed-in facility, with type and reference/supplier/status filters. Preview and print preparation are separately audited and fail closed if the disclosure audit cannot be retained.

- Purchase orders show current ordered and received quantities, prices, preparation/submission/approval actors, expected delivery and notes. Draft/submitted orders say **NOT AUTHORISED**; cancelled orders say **DO NOT SUPPLY** and include the cancellation reason and actor. Printing resolves the current order again.
- Each new receiving operation creates one numbered goods receipt, linked to its purchase order and stock movement. Its supplier, receiver, item, quantity, purchase cost, batch, expiry and store details are retained in the same transaction as stock and accounting. A database trigger prevents updates or deletion. Later corrections do not rewrite the original receipt.
- Partial receipts remain partial until every order line is fulfilled. Receipt retries return the original document; changed details, another actor or another facility cannot reuse the key. Receiving rejects quantities beyond three decimal places and legacy orders without positive prices.
- Decimal rounding keeps fractional receipt values consistent with accounting entries. The existing stock and independent approval controls remain in force.
- The additive `20261015090000_goods_receipt_documents` migration must be deployed with the application release. Existing stock movements are retained as history; no retrospective GRNs are fabricated. One GRN represents one receiving operation, not a combined supplier invoice or a signed proof of delivery.

Verification for this delivery:

- All 419 unit/API tests passed across 89 files, including audited document access, facility scoping, current cancellation evidence, list bounds and decimal valuation.
- Production build and TypeScript passed; all 50 migrations passed in an isolated database.
- The production-mode outpatient runner passed 122 checks. New coverage includes partial/multi-line receipts, independent approval, replay conflicts, failed-retention transaction rollback, original receipt preservation after metadata correction, database immutability, stock/accounting reconciliation and cross-facility print denial.
- Interactive browser verification covers the document register, type/status/reference filters, empty results, previews, branding, cancellation warnings, completed order quantities and approval details. Refresh clears the preview; a simulated connection failure removes stale results and shows an error. No production database was used or migrated.

Normal-browser PDF verification (15 October 2026):

- Chrome 155 on Windows saved both documents through its native **Print / Save PDF** dialog. The two-line received purchase order and original one-line goods receipt each produced one clean Letter portrait page, with the browser's existing headers/footers enabled. Both saved PDFs were rendered and visually inspected: logo, references, quantities, currency values, approval/receipt actors and footer text were legible, with no clipping or application navigation in the output.
- The received order total was KES 10.10, including the rounded fractional line. The original receipt retained Synthetic Medical Supplies, batch DOC-DELIVERY-1, expiry 2028-10-13, Main pharmacy, quantity 1 and total KES 3.35 after later metadata corrections.
- Fixed the generic suggested PDF filename and metadata title: each now includes the document reference and type. Chrome's native save dialogs and saved metadata confirmed both titles. The original app title and enabled controls return after saving or cancelling printing.
- The cancelled purchase order's native print preview showed **CANCELLED — DO NOT SUPPLY**, the cancellation reason and actor without clipping. No browser console errors or warnings were recorded during these checks.
- The production build and all 122 isolated workflow checks passed again. All 419 tests passed after giving the Git-process-heavy committed-evidence hash test a 15-second timeout; its assertions are unchanged. It had exceeded the default five seconds twice on Windows.
- Physical printers, other browsers, other paper settings and large multi-page orders remain staff UAT coverage.
