# Clinic flow improvement — 25 September 2026

Reference: [Hosipoa public module directory](https://hosipoa.co.ke/modules/) and [patient journey overview](https://hosipoa.co.ke/), reviewed 25 September 2026. The useful benchmark is connected reception, clinical, diagnostic, dispensing and cashier work on one patient record. Public material is a capability overview, not a detailed operating manual or verified permission specification.

## Implemented

The active worklist previously fetched only the newest queue for each visit. Home then chose one department, so parallel tasks could be hidden. It now loads all active department queue metadata, retains facility scoping and disclosure audit, and presents each permitted department task separately. Clinical/order/financial projections remain role-scoped. A laboratory task and a pharmacy task for the same patient are both discoverable by staff with both permissions, with separate waiting clocks.

Home provides department filters/counts, visit-number search, called/in-progress/waiting labels and direct patient actions. The context bar shows active departments and only offers actions allowed by the user's permissions. Reception with measured-vitals permission opens vitals rather than nurse triage. Completed/cancelled visits produce no work; clinical closure suppresses clinical tasks but preserves an explicit active billing queue. It neither settles invoices nor infers clinical discharge from payment.

Duplicate active entries for the same visit/department produce one task using the oldest active entry's clock. Counts distinguish department tasks from distinct patients. Existing 15-second refresh and stale-data warning remain. Elapsed time is since department queue entry, including time in progress, not a predicted waiting-room delay. Existing overdue heuristics remain; this change does not claim to implement the separately configured service target on the home board.

## Validation and limits

Unit scenarios cover parallel departments, different queue clocks, duplicate/history entries, closure/payment separation and facility/audit/minimum-data protections. All 368 unit tests and type checking passed; route audit inventory reports zero gaps/unclassified routes. Browser validation uses a synthetic intercepted worklist to check department filtering, visit search and mobile layout, plus the existing authenticated home workflow against an isolated database. No migration, role provisioning, production fixture or clinical policy change is required.

This addresses discoverability and handoff continuity. It does not claim Hosipoa parity for national insurance, messaging/reminders, inpatient care, specialty programme coverage or clinical certification. Those require their own validated workflows and external integrations.
