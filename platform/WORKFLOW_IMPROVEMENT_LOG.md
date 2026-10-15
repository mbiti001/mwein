# Mwein workflow improvement log

## Working agreement

The user authorised continuous workflow auditing, corrections, online research, testing and pushes to the existing `codex/hosipoa-expiry-report` branch on 15 October 2026. They will not answer questions while asleep. Continue with routine implementation decisions and record external dependencies. Preserve production release gates and use synthetic local data. Hourly continuation is attached to this chat as `continue-mwein-workflow-improvements`.

## Completed batch: connected outpatient worklists — 15 October 2026

Verified locally on 15 October 2026. This batch is ready for the authorised branch push; check Git history/status on continuation to confirm the push and avoid repeating it.

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

## Research basis

- [HosiPoa modules](https://www.hosipoa.co.ke/modules/), reviewed 15 October 2026: connected reception, appointment, queue, referral, diagnostic, pharmacy and cashier capabilities inform the backlog. Public scope descriptions are not implementation specifications.
- [WHO SMART business processes](https://smart.who.int/hiv/business-processes.html), reviewed 15 October 2026: explicit actors, activities, referral and follow-up processes inform the handoff design. This does not claim implementation of the HIV clinical programme.
- [WHO Interagency Integrated Triage Tool](https://www.who.int/tools/triage), reviewed 15 October 2026: urgency-based prioritisation informs queue ordering. Existing local priority categories remain unchanged; this batch does not implement or claim certification against IITT algorithms.
- [WHO primary health care digital transformation handbook](https://iris.who.int/bitstream/handle/10665/379452/9789240093362-eng.pdf), reviewed 15 October 2026: workflow analysis, returning-patient identification and local adaptation inform the reception audit.
- [Kenya Ministry of Health referral-policy development update](https://health.go.ke/kenya-moves-strengthen-patient-referral-system-through-new-national-policy), 6 March 2026: continuity and documented referral handoffs are relevant context. The news item describes policy development, not a final legal or interoperability specification.

These are engineering adaptations. No new diagnosis, prescribing rule, national reporting mapping, certification status or live integration is inferred from these sources.

## Remaining audit order

1. Confirm the connected-worklist batch is committed/pushed and preserve any new user changes before starting another batch.
2. Review duplicate active-visit prevention under concurrent check-in; the current duplicate read in `api/visits/route.ts` occurs before the creation transaction. Verify existing database constraints and reproduce concurrency before changing behaviour. Also review a saved check-in followed by a failed queue refresh so a retry cannot create duplicate work.
3. Audit diagnostic result review handoffs, outstanding investigations, consultation draft recovery, unsaved-change protection and closed-visit boundaries.
4. Audit pharmacy partial dispensing, stock shortages, substitutions and return-to-clinician actions; retain independent medication governance.
5. Review cashier reconciliation, partial payment, refund/reversal and discharge views with synthetic scenarios. Keep clinical closure independent of financial settlement.
6. Design an attributable follow-up resolution/contact-attempt register, linking subsequent care and preserving original signed plans. Current worklists do not prove outreach or follow-up completion.
7. Review accessibility, keyboard navigation, mobile layouts, search/empty/error states and remaining race conditions across all workstations. Add a short debounce for worklist-backed patient searches without reintroducing stale results; review the referral tracker's older request handling and hidden 12-row limit. Consider disabling empty/busy queue call-next controls with an explanation, and validate duplicate transfer protection under real concurrent requests.
8. Specify ward/bed allocation, nursing tasks and discharge reconciliation before adding inpatient screens. Programmes, immunisation schedules, national integrations and clinical policy need governed specifications and acceptance evidence.

## External dependencies

Physical printer and large-document UAT, clinician/finance acceptance, independent security review, recovery evidence, production migration/release approval and verified national integration contracts remain separate from local engineering checks. Record these as dependencies and continue actionable development.
