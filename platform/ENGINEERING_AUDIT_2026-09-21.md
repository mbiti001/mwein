# Engineering audit — 21 September 2026

## Executive status

The application builds cleanly and its core outpatient flow is working across the browser, API, database, and reporting layers. This review fixed the most immediate patient-context, billing-integrity, cancellation-concurrency, stale-data, reporting, and information-disclosure risks. The application is suitable for controlled pilot use after the facility completes its operational readiness evidence; it is not yet approved for unrestricted clinical production solely on the strength of software tests.

## Improvements completed in this review

1. **Patient context isolation** — the consultation form now remounts when the active visit changes, preventing complaints, diagnoses, and uncontrolled form values from carrying into another patient's record.
2. **Immutable dispensing charges** — each dispensing event now creates a separate invoice line with its actual quantity, medicine, and effective price. Partial fills, substitutions, and later tariff changes no longer rewrite earlier charges.
3. **Cancellation concurrency** — visit cancellation now uses serializable transaction isolation. Database write conflicts return a controlled 409 response and confirm that no partial change was committed.
4. **Accurate operational reports** — void invoices and cancelled visits are excluded from billed, received, and outstanding totals. Cancelled queue entries are reported separately and no longer distort average or P90 completion times.
5. **Visible stale-data state** — overlapping visit refresh requests are deduplicated. If live queue refresh fails, staff see when the displayed data was last updated and can retry explicitly.
6. **Safer public readiness response** — the unauthenticated readiness endpoint now returns only `ready` or `blocked`; detailed control gaps remain available through authenticated administration views.
7. **Accessible typography retained** — the interface uses the native system font stack at 16px with comfortable line height, normal tracking, visible focus states, larger controls, reduced-motion support, and stronger high-contrast borders.
8. **ICD-11 traceability and resilience** — WHO identifiers are accepted in their canonical form, each diagnosis can retain its MMS release and linearization URI, token requests are deduplicated, upstream calls have timeouts, and temporary WHO outages are shown explicitly when facility-history fallback is used.

## Verification evidence

- TypeScript: passed.
- Unit/API tests: 177 passed across 47 files.
- Outpatient integration workflow: 70 checks passed.
- Browser workflow tests: 22 passed, including mobile navigation and visit-summary print/mobile layouts.
- Prisma migration verification: 37 migrations applied and validated against an isolated PostgreSQL-compatible database.
- Production build: passed on Next.js 16.3.3.
- Production dependency audit: zero known vulnerabilities.
- Visual smoke test: page rendered with meaningful content, no framework error overlay, 16px system-font body text, and no browser error logs.

## Remaining priority work

### High — operational approval and recovery evidence

Production readiness remains intentionally blocked until the facility records its governance approvals and configures the identity provider, audit-retention target, and database-backup target. Complete an encrypted backup and independent restore drill, assign alert ownership, and obtain clinical/operational sign-off before unrestricted use.

### High — replay-safe patient payments

Payment balance checks use serializable transactions, but payment creation still lacks a client-supplied idempotency key. Add a unique idempotency key per payment attempt and test lost-response retries so staff cannot create two valid partial payments after retrying an uncertain submission.

### Medium — queue payload scale

The visit refresh endpoint returns nested records for all active visits every 15 seconds. Split lightweight queue summaries from full patient detail, paginate larger worklists, and load the clinical record only when a visit is opened. Run realistic-volume latency and database-query tests.

### Medium — reporting time-basis consistency

Operations receipts are grouped by visits arriving in the selected period, while cashier receipts are grouped by payment date. Choose and label a consistent transaction-period or visit-cohort basis so cross-day totals are not misread as reconciliation differences.

### Medium — identity-provider completion

OIDC configuration and group mapping exist, but the full discovery, callback, failure recovery, and MFA flow still needs implementation and conformance testing with the selected provider.

### Clinical governance backlog

Complete approved medication-rule content with unit-aware dose limits and validated age, weight, pregnancy, and renal contexts. SHA eligibility, preauthorisation, claims transport, KHIS exchange, laboratory device interfaces, and communication delivery need external contracts, mappings, callbacks, and acceptance evidence before being represented as live integrations.

WHO ICD-11 live search is implemented but production credentials are not configured. Register or retrieve a WHO ICD API client, add `ICD11_CLIENT_ID`, `ICD11_CLIENT_SECRET`, and the approved `ICD11_RELEASE`, then complete a live search-and-save acceptance test.

## Recommended next sequence

1. Add replay-safe payment idempotency and concurrent retry tests.
2. Separate queue summaries from clinical record payloads and performance-test at expected facility volume.
3. Complete identity, backup/restore, audit-retention, and governance evidence.
4. Reconcile reporting time bases and add management drill-downs.
5. Complete external integration conformance and clinical rule governance.
