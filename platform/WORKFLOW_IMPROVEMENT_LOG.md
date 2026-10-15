# Mwein workflow improvement log

## Working agreement

The user authorised continuous workflow auditing, corrections, online research, testing and pushes to the existing `codex/hosipoa-expiry-report` branch on 15 October 2026. They will not answer questions while asleep. Continue with routine implementation decisions and record external dependencies. Preserve production release gates and use synthetic local data. Hourly continuation is attached to this chat as `continue-mwein-workflow-improvements`.

## Completed batch: connected outpatient worklists — 15 October 2026

Committed and pushed as `1f53728` on the authorised branch. Confirmed against origin at the start of the check-in batch; do not repeat this work.

- Reception: Nairobi-day appointment lists, explicit statuses, safe rescheduling/no-show transitions, bounded patient-filtered queries, current messaging consent, booking form recovery, request cancellation and stale-result protection.
- Continuity: searchable dated follow-up worklists, visible limits, direct links to the original appointment/referral/clinical record, invalid-plan-date rejection and signed specialty plans.
- Queue operations: visible loading/failure state, unavailable controls until loaded, current service targets, service-specific history, specialty handoffs, server-side pause checks, duplicate-transfer rejection and separate billing after clinical closure.
- Patient selection: cancel superseded searches, avoid displaying stale matches, keep appointment/visit identity fixed and prevent repeated registration/check-in submissions.
- Navigation: clear unrelated patient context on work-area changes; late registration, check-in, triage, consultation and cancellation responses may refresh data but cannot undo newer navigation. A full-browser run exposed the triage race; the regression now deliberately delays that response until after staff open consultation.

Validation evidence:

- `npm run lint`: passed.
- `npm test -- --maxWorkers=2`: 454 tests passed across 94 files. Coverage includes facility filters, access denial, disclosure audit failure, strict follow-up dates, bounded lists, appointment transitions, paused service starts, duplicate transfers and billing after clinical closure.
- `npm run test:browser`: final full run passed all 60 scenarios using installed Windows Chrome. The runner builds the production application and prepares an isolated database before tests. New scenarios cover follow-up destinations/permissions, failed-refresh recovery, out-of-order search, booking retry/reset, queue targets, appointment-to-walk-in patient changes and delayed triage navigation.
- Isolated production-mode `scripts/e2e-outpatient.mjs`: 123 checks passed, including migration/bootstrap, permissions, facility isolation, clinical/billing/stock workflows, retained supply documents, audit chain and mandatory MFA. No production data or services were used.
- Interactive Chrome review: opened a missed synthetic appointment from follow-up work, rescheduled it to 16 October at 10:00 EAT, confirmed the saved status/time and its removal from recall, then verified it in Upcoming at 390 px width. No horizontal document overflow. Browser viewport restored and temporary review services stopped.
- Visually inspected desktop and phone screenshots; evidence saved in the chat's `outputs` folder as `mwein-appointment-workflow.jpg`, `mwein-appointment-mobile.jpg`, `mwein-follow-up-desktop.png` and `mwein-follow-up-mobile.png`. Appointment images use the isolated database; follow-up category images use deterministic synthetic browser fixtures.
- `git diff --check`: passed. No database migration or production deployment in this batch.

Remaining limits: follow-up counts are explicitly bounded; clinical dates are scanned from the latest 1,000 signed encounters in the last year. Opening a work item is not outreach or proof of care completion. A resolution/contact register remains to be designed. The current facility workflow uses Africa/Nairobi dates. The prior purchase-order/goods-receipt print verification remains recorded in Git history and its output files.

## Completed batch: reliable check-in and recovery — 15 October 2026

Verified for the authorised branch push. The working tree was clean and synchronized with origin before this batch. Consult Git history/status on continuation for this batch's commit and push; the next actionable audit is diagnostics and consultation recovery below.

- Reproduced the original race against the isolated production application: simultaneous requests with the same check-in key both returned 201 and created visits. The duplicate read now runs inside the serializable transaction, with bounded retries of the complete transaction after serialization or uniqueness conflicts.
- Added a database constraint for one clinically open visit per facility/patient, including admitted care. Clinical closure and terminal statuses permit subsequent care independently of outstanding payment. The patient finder uses the same clinical-open definition.
- Retained optional facility-scoped request UUIDs and input fingerprints bound to the staff member. An exact retry confirms the original visit with its current status, even after appointment completion or visit cancellation. Changed routing or another staff member's key is rejected. Older clients without keys retain duplicate-open-visit protection.
- Visit, invoice, queue, appointment transition and creation audit remain atomic. Successful replay and existing-visit disclosure append attributable audit events before returning minimal visit details; replay requires current authorization. Responses are private and non-cacheable.
- The check-in form preserves the exact request after an ambiguous failure, locks patient/routing fields and offers **Retry same check-in**. A failed retry does not discard the original identity. When another request already created the visit, staff can open that visit rather than add work.
- A successful save followed by a failed worklist refresh now clearly confirms the visit number and offers queue recovery. Recovery uses GET; it does not submit another check-in. Replays of progressed or closed visits do not route staff into a new initial assessment.
- Migration `20261015090000_check_in_reliability` performs its preflight and DDL atomically under a table lock. Existing duplicate open visits stop migration with an explicit review requirement. No legacy care records are automatically merged, cancelled or closed.

Validation evidence:

- `npm run lint`, Prisma generation and schema validation: passed. Schema validation used a local placeholder database URL and made no database connection.
- `npm test -- --maxWorkers=2`: **470 tests passed across 96 files**. New coverage includes scoped access, permission denial, input/actor replay mismatches, audited duplicate/replay responses, audit failure and bounded transaction retries. Four database tests exercise legacy duplicate preservation, admitted-care uniqueness, clinical closure with outstanding payment, facility scope and replay-key constraints.
- `npm run test:migrations`: **51 migrations passed**, including existing immutable-history, financial and stock constraints. The new migration also ran in the isolated production browser fixture.
- `npm run test:browser`: **66 scenarios passed** using installed Windows Chrome. This builds the production app and waits for the isolated outpatient fixture's **123 workflow checks** before running browser scenarios. New cases cover simultaneous same-key retries, simultaneous independent requests, appointment/cancellation replay, changed routing, lost responses, a failed retry, failed queue refresh and an existing-visit handoff.
- The same-key concurrency case now returns 201/200 with one visit, one invoice and one queue task; independent keys return 201/409 identifying the same visit. The lost-response browser case sends identical request bodies on all three attempts and retains one saved visit.
- Inspected desktop and 390 px mobile screenshots; mobile recovery has no horizontal overflow. Evidence is in the chat's `outputs` folder: `mwein-check-in-recovery-desktop.png`, `mwein-check-in-recovery-mobile.png`, `mwein-check-in-confirmed-refresh-failure.png`. Screenshots and mutations use synthetic local records only.
- Temporary browser fixture services stopped after the suite. No production migration or deployment was performed. `git diff --check` passed before commit.

Limits and release dependency: the browser retains an unconfirmed request while its form remains mounted; navigating away or reloading does not persist that form request in browser storage. Database protection still prevents simultaneous clinically open duplicates. Full HTTP replay requires clients to send the optional UUID. Deployment requires applying the migration before the new application, with an attributable review of any pre-existing duplicate open visits and the existing production release approvals. Local PostgreSQL-compatible migration/concurrency checks do not replace the production database rehearsal or clinician/finance acceptance.

## Research basis

- [HosiPoa modules](https://www.hosipoa.co.ke/modules/), reviewed 15 October 2026: connected reception, appointment, queue, referral, diagnostic, pharmacy and cashier capabilities inform the backlog. Public scope descriptions are not implementation specifications.
- [WHO SMART business processes](https://smart.who.int/hiv/business-processes.html), reviewed 15 October 2026: explicit actors, activities, referral and follow-up processes inform the handoff design. This does not claim implementation of the HIV clinical programme.
- [WHO Interagency Integrated Triage Tool](https://www.who.int/tools/triage), reviewed 15 October 2026: urgency-based prioritisation informs queue ordering. Existing local priority categories remain unchanged; this batch does not implement or claim certification against IITT algorithms.
- [WHO primary health care digital transformation handbook](https://iris.who.int/bitstream/handle/10665/379452/9789240093362-eng.pdf), reviewed 15 October 2026: workflow analysis, returning-patient identification and local adaptation inform the reception audit.
- [Kenya Ministry of Health referral-policy development update](https://health.go.ke/kenya-moves-strengthen-patient-referral-system-through-new-national-policy), 6 March 2026: continuity and documented referral handoffs are relevant context. The news item describes policy development, not a final legal or interoperability specification.
- Check-in batch, reviewed 15 October 2026: rechecked the [HosiPoa reception/check-in and queue module scope](https://hosipoa.co.ke/modules/) and [WHO primary health care transformation handbook overview](https://www.who.int/publications/i/item/9789240093362). These support workflow mapping and coherent patient handoffs; neither specifies our replay algorithm or database constraint.
- [Kenya Ministry of Health digital health transformation update](https://www.health.go.ke/ministry-health-launches-biometric-health-identification-advances-digital-health-transformation), published 5 August 2025 about the 4 August launch: identity, accountability and care continuity inform the engineering audit. Reviewed through the primary site's indexed content after direct fetch timed out. This batch implements no biometric identification, national HIE connection or national approval claim.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) and [Prisma 6 transaction guidance](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions), reviewed 15 October 2026: whole-transaction retry for serializable conflicts informs the concurrency fix. A database unique index supplies an independent boundary.

These are engineering adaptations. No new diagnosis, prescribing rule, national reporting mapping, certification status or live integration is inferred from these sources.

## Remaining audit order

1. Audit diagnostic result review handoffs, outstanding investigations, consultation draft recovery, unsaved-change protection and closed-visit boundaries. Check Git status first and preserve any new user changes; the check-in race/recovery batch above is complete.
2. Audit pharmacy partial dispensing, stock shortages, substitutions and return-to-clinician actions; retain independent medication governance.
3. Review cashier reconciliation, partial payment, refund/reversal and discharge views with synthetic scenarios. Keep clinical closure independent of financial settlement.
4. Design an attributable follow-up resolution/contact-attempt register, linking subsequent care and preserving original signed plans. Current worklists do not prove outreach or follow-up completion.
5. Review accessibility, keyboard navigation, mobile layouts, search/empty/error states and remaining race conditions across all workstations. Add a short debounce for worklist-backed patient searches without reintroducing stale results; review the referral tracker's older request handling and hidden 12-row limit. Consider disabling empty/busy queue call-next controls with an explanation, and validate duplicate transfer protection under real concurrent requests.
6. Specify ward/bed allocation, nursing tasks and discharge reconciliation before adding inpatient screens. Programmes, immunisation schedules, national integrations and clinical policy need governed specifications and acceptance evidence.

## External dependencies

Physical printer and large-document UAT, clinician/finance acceptance, independent security review, recovery evidence, production migration/release approval and verified national integration contracts remain separate from local engineering checks. Record these as dependencies and continue actionable development.
