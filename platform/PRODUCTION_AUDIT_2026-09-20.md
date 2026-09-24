# Production audit — 20 September 2026

Reviewed commit: 3c0339d. Read-only production health checks, source inspection, reporting reproductions, unit suite and production dependency audit. No production patient records were accessed or changed. No fixes or deployments were made during this audit.

## Assessment

The deployment runs and the database is connected with the latest clinic-tariff migration. It is not yet demonstrated ready for unrestricted clinical operation. The public readiness endpoint returns blocked, with 0/11 current approval records and missing identity-provider, audit-retention-target and database-backup-target configuration. Missing records do not prove the underlying organisational work has never occurred. Readiness is a reporting endpoint, not a global enforcement gate: login and ordinary routes do not consult it.

## Priority findings

1. **High — patient switching can retain another patient's form state.** `src/components/ConsultationWorkstation.tsx:1117` renders ConsultationForm without a patient/visit key. The initialVisitId effect can replace active while that form remains mounted. Complaints and diagnoses initialise from props only once; uncontrolled input defaults also persist. A save uses the new visit id. Reset/remount by visit, protect unsaved changes and cancel stale history responses. Verify direct A-to-B switching through the global patient finder with distinct drafts and delayed responses. This is a source-confirmed unsafe path, not a claim of observed production contamination.

2. **High — partial dispensing rewrites earlier charges.** `src/app/api/orders/[id]/dispense/route.ts:311` updates the single order invoice line to cumulative quantity at the latest dispensed item's current price and identity. Example: five tablets at 10 followed by five at 12 produces 120 instead of 110. Use immutable per-dispensation charges or an explicitly locked price; preserve item identity for substitutions. Verify multiple supplies across tariff changes and substitutions against the stock ledger and invoice.

3. **High — cancellation needs concurrency protection.** `src/app/api/visits/[id]/cancel/route.ts:18` uses the default transaction isolation and checks safety conditions before later writes. Concurrent consultation/payment/order work can change the assumptions. Coordinate locking or conditional transitions across mutation routes and handle conflicts explicitly. This is a source-based race risk; a concurrent integration reproduction is still required.

4. **High — operational reports include cancelled charges.** `src/lib/reporting.ts:45` totals every invoice's lines; the report query neither excludes cancelled visits nor selects invoice VOID status. Reproduced locally: a cancelled visit with a 500 charge reports billed=500 and outstanding=500. Exclude void charges and show cancellations separately.

5. **Medium — queue statistics treat cancellation as completed care.** `src/lib/reporting.ts:88` accepts every completedAt timestamp regardless of status. Reproduced: a cancelled triage queue counts as one completed service and affects average/P90. Define completed, transferred and cancelled denominators separately.

6. **High operational gap — identity, recovery and retention are incomplete.** Production reports missing configuration for all three. OIDC configuration/group mapping exists, but auth discovery/callback routes are absent. Complete and test provider login/MFA, recovery access, encrypted backups with independent restore, retained audit exports and ownership of alerts. Do not mark gates approved merely to clear the dashboard.

7. **Medium — slow or disconnected clients silently show stale queues.** `src/components/ClinicalApp.tsx:179` ignores refresh errors. The active-visits endpoint returns all active visits with nested records every 15 seconds without top-level pagination. Add last-successful-refresh/offline status, prevent overlapping requests and stale response overwrites, and separate lightweight queue retrieval from patient details. Load and latency testing has not been performed.

8. **Medium — payment retry and conflict handling need hardening.** `src/app/api/invoices/[id]/payments/route.ts` has serializable balance checks but no request idempotency key. A lost response followed by retry can create another partial payment while a balance remains. `src/lib/http.ts` does not translate serialization conflicts into a controlled retry response. Add replay-safe payment requests and concurrent submission tests.

9. **Medium — inconsistent reporting time bases.** Operations summary receipts are all payments attached to visits arriving in the selected period, while cashier receipts are filtered by payment date. They can disagree across days. Label cohort totals clearly or use a common transaction-period basis.

10. **Medium — public readiness reveals internal deployment details.** `/api/ready` discloses facility code and missing controls without authentication. Keep a minimal public status and detailed authenticated administration output.

## Remaining features

- Medication safety: approved rule content, unit-aware dose limits and validated age/weight/renal contexts. Current daily-quantity rules are not a complete clinical dosing knowledge base.
- SHA: executed terms, confirmed tariffs, credentials, authenticated eligibility/preauthorisation/claim transport and conformance testing. Local preparation is not live authorisation.
- Communication: delivery outbox, provider callbacks, consent/opt-out checks and retry handling.
- Patient measurements: historical pagination, actual laboratory result timestamps and method-aware comparison. Current display uses the last 20 historical visits and visit dates for laboratory results.
- Management: correct financial/queue metrics first, then period comparisons and drill-downs.
- Multi-facility switching and consolidated reporting only after explicit membership and cross-facility permission design.
- KHIS and laboratory-device interfaces require approved mappings and external acceptance testing.

## Verification and limits

- Fresh unit suite: 175 passed across 47 files.
- Fresh production dependency audit: zero known vulnerabilities reported by npm audit --omit=dev.
- Live /api/health: OK, database connected, migration 20260920130000_clinic_consultation_tariffs.
- Live /api/ready: blocked, 0/11 approvals recorded.
- Prior release: 70 integration checks, 21 browser tests, 36 migration checks and production build passed. Not rerun for this read-only audit.
- Reporting defects reproduced with synthetic input using the actual reporting functions.
- No independent penetration test, authenticated production UX audit, concurrency reproduction, realistic-volume load test, disaster recovery drill or clinical sign-off was performed in this audit.

## Recommended execution order

First fix patient switching, partial-dispense billing and cancellation/payment concurrency. Then fix financial and queue reporting, payment replay handling and stale-screen feedback. In parallel with subsequent development, facility owners should complete identity/recovery/retention and clinical acceptance evidence. New modules should follow these reliability fixes.
