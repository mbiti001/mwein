# Latest-main synchronization and action fixes

27 September 2026. Review branch: `codex/main-action-fixes`.

## Correct application baseline

Fetched `https://github.com/mbiti001/mwein.git` and created a fresh managed checkout of `origin/main` at **`c0a71c77615875bf5f969bf934d3f1f42f336e09`**. The previous local baseline, `adc0dc4`, was 21 commits behind. The original checkout at `/Users/useruser/Downloads/mwein`, including its unpublished work, was preserved rather than overwritten or reset.

Latest main already includes clinic forms, current wordmark assets, parallel department worklists, local reporting/IDSR, measured vitals, MFA and recovery, DPO protections, separate report permissions, guarded restore tooling, committed-source evidence collection and the corrected FHIR patient identifier. Those implementations are retained. Earlier audit findings about those missing capabilities must not be applied unchanged to this newer baseline. No earlier draft MFA migration was copied onto main's different migration history.

## Changes applied here

### Reliable actions and consistent buttons

- Removed `SaveFeedback`, a global click listener/MutationObserver that hid the most recently clicked action whenever any success notice was inserted. It could hide unrelated actions, left keyboard submissions outside its model, and mutated React-owned DOM. Success messages now stay in their own workflows and expose `role="status"` directly.
- Adapted the native-button/variant structure from the MIT-licensed [shadcn/ui Button](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/new-york-v4/ui/button.tsx). The [license and attribution](../THIRD_PARTY_NOTICES.md) are included. This is a small adaptation to our CSS, not installation of the full shadcn/Tailwind framework.
- Added a reusable Button with explicit button/submit semantics, disabled pending state, a pending label, `aria-busy` and a reduced-motion-aware spinner. Applied it to sign-in, billing actions, staff saves and clinic documents. Structured patient/queue rows retain their own layout.
- Unified primary, secondary and destructive action styling: consistent padding, rounded corners, visible keyboard focus, hover states and 44px minimum action heights. Existing navigation and clinical content are retained.
- Added synchronous submission guards to staff changes, document saves and payment recording; disabled discard/reversal/back actions where they could conflict with an in-flight save. Staff success no longer removes the button needed for the next account.
- A successful payment followed by a failed queue refresh now reports that the payment succeeded, instead of implying the payment failed and encouraging a duplicate entry.

### Payment retries and receipt integrity

Added migration **`20260927090000_payment_replay`** and a durable `PaymentRequest` record. The record and payment/receipt are committed in one serializable transaction.

- Payment requests require a UUID `idempotencyKey`; the current billing form and fixture submit one. API clients must be updated with this contract before rollout.
- Same facility/key and same normalized invoice/method/amount/reference return the original response and receipt (200, `Idempotency-Replayed: true`). The first committed payment returns 201. Changed details return 409.
- Non-cash reference reuse on the same invoice/method also returns the original result for matching details, even if the browser supplies a new key. Conflicting amounts are rejected. Historical payments without a replay record are detected and return a review-required conflict.
- Reference uniqueness is scoped to an invoice and method within a facility. Cross-invoice allocation/provider reconciliation is not guessed; this is manual receipt integrity, not a live M-Pesa gateway.
- Database uniqueness and bounded retries handle concurrent requests. Amounts require at most two decimal places.
- The browser keeps the same key when retrying an unchanged payment after an uncertain response. The durable response is the original transaction snapshot; use current invoice/payment history for later reversals or changes. After a page reload during an uncertain cash payment, review receipt history before starting a new payment: an entirely new key represents a new command.

### Relevant earlier fixes carried forward

- Forecasts and operations stock summaries exclude expired, depleted and inactive batches. The tested stock helper was carried forward without replacing main's newer disclosure-audit controls.
- Dispensing replay lookup now includes the authenticated facility relationship. Knowing another facility's order ID and replay key must not disclose its dispensing response.
- Existing DPO/report/FHIR/restore fixes on main were not replaced with older local versions. No external integration was enabled.

## Verification

- Full unit suite: **396 tests passed across 85 files**.
- TypeScript (`npm run lint`), production build and `git diff --check`: passed.
- Migration verification: **49 migrations passed**, including the new payment replay table.
- Production-mode isolated PGlite fixture: **100 workflow checks passed**, including cash replay and changed-payload rejection.
- Full browser run initially passed 48 of 50 cases. Two new test-harness issues were corrected: an alert locator also matched Next.js's route announcer, and APIRequestContext did not automatically replay a Secure cookie on HTTP loopback. Application cookie security was unchanged. Both cases subsequently passed.
- Final focused browser run: **4/4 passed** (sign-in failure/keyboard retry, mobile focus/action sizing, concurrent API payment replay, and payment-form recovery after a response is lost). The lost-response test confirms the original receipt is returned and exactly one payment exists. Together with the 48 existing cases above, all 52 distinct browser cases passed across these runs. Existing main's MFA browser scenarios passed in the full run; the older checkout's MFA test result is not the result for this baseline.
- Saved [test logs](main-action-fixes-20260927/) and [mobile action screenshot](main-action-fixes-20260927/mobile-actions.png). The initial browser log is retained to disclose the corrected harness failures; the final action log contains the passing rerun.

These are local synthetic checks, not a production performance test, clinical acceptance, penetration test or DHA certification. No live database migration, deployment, push or real payment was performed.

## Review and test

The preview at **http://127.0.0.1:3210/** runs this new checkout with synthetic data and external WHO/AI connections disabled. It is an offline workflow test fixture, not an integration-complete review environment. Live ICD-11 search is not available in this fixture; diagnosis search is limited to facility history. The deployed app is https://mwein-hmis-platform.vercel.app/. Facility `MMS`, email `admin@mwein.local`, password `Mwein-E2E-Password-2026!`. Do not use real patient information. The in-memory database is temporary and disappears when the fixture stops.

1. Sign in with the mouse, then separately test keyboard Enter. On a failed request, inputs should remain and the action should become available again.
2. Open Administration → Users & access. After creating a synthetic account, the success notice and Create staff account button should both remain visible.
3. Open Clinic forms → Delivery note. Save a synthetic draft, edit it, save again and review/sign only if appropriate for the test. Save/discard/sign controls should remain predictable; signed originals remain immutable.
4. In Billing, record a small synthetic non-cash partial payment and review its receipt. Repeating the same invoice/method/reference must not produce another receipt. A changed amount with that reference must be rejected. Cash retries use the same request key; a genuinely new cash payment requires a new command.
5. Review controls at phone width: no horizontal overflow, visible focus and reachable actions. Review the saved mobile screenshot alongside the automated test results.

To recreate the preview from this checkout's `platform` directory after stopping the previous fixture:

```bash
npm ci
npm run db:generate
npm run build
E2E_PRODUCTION=1 E2E_HOLD=1 E2E_KEEP_TEMPORARY_PASSWORD=1 \
E2E_APP_PORT=3210 E2E_DB_PORT=3211 \
AI_VISIT_SUMMARY_ENABLED=false ICD11_CLIENT_ID='' ICD11_CLIENT_SECRET='' \
npm run test:e2e
```

The new migration must precede the new payment endpoint in any approved deployment. Changes remain local and reviewable on the branch above.

## ICD-11 preview correction — 27 September 2026

The user reported missing ICD-11 search after the preview handoff. The local fixture had been launched with explicitly empty `ICD11_CLIENT_ID` and `ICD11_CLIENT_SECRET`. The diagnosis route and UI were not removed. A local authenticated search returned HTTP 200, `source: Facility history`, `configurationRequired: true`, and no matches for the generic query “cholera”.

Vercel's existing Production configuration still lists all three ICD-11 keys. Downloading that configuration returns redacted placeholders for those secrets, not usable credentials. No production configuration was changed. The user has only the production setup, so live local restoration remains blocked on locally available WHO credentials. Do not describe this as a restored live connection. The 11 focused ICD-11 route, identifier and signed-selection tests pass; these use mocks and do not establish live WHO availability.

The explicitly empty ICD variables in the fixture command above deliberately keep automated checks offline. Do not reuse that command for live-integration acceptance. For a local live review, supply WHO credentials through a private server environment, remove those empty overrides, verify with `ops:icd11-verify`, and exercise diagnosis selection in the browser before handing over. Keep the synthetic database separate from Production.
