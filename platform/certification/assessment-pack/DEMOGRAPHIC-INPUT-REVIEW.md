# Demographic input accuracy review — 1.6.2 candidate

16 October 2026. Engineering review against baseline `88c74e1307c363619b4f64aa96ce1ee19190b947`; final frozen-source retests and release evidence remain pending. This document records the bounded correction and its acceptance criteria, not completed verification, clinical approval or DHA certification. The existing 1.6.1 deployment remains a separate immutable release.

## Confirmed defects and impact

| Surface | Baseline source evidence | Incorrect outcome |
| --- | --- | --- |
| Registration estimated age | `src/lib/domain.ts`, `patientRegistrationSchema.estimatedAgeYears`, uses unrestricted `z.coerce.number()` before integer/range checks. | Blank or whitespace text, null, false and an empty array can become age zero; true or a singleton numeric array can become an integer. In ordinary registration, this can satisfy the age-or-birth-date requirement without an actual age observation. Emergency identity exceptions must not turn omitted information into a made-up age. |
| Controlled correction in the browser | `src/components/PrivacyRightsPanel.tsx`, `applyCorrection`, calls `Number(value)` for estimated age, then sends the request through JSON serialization. | Invalid numeric text becomes `NaN`, which JSON serializes as null. The server deliberately permits null for clearing an optional age, so invalid text can be mistaken for an intentional clearing instruction. Empty or whitespace text can instead become zero. |

The correction API in `src/app/api/patients/[id]/privacy/route.ts` already requires `privacy.manage`, a facility-bound patient and request, an in-review correction request, identity evidence and a reason. It commits the demographic change, its audit event and request completion within a transaction. Those controls do not distinguish a deliberately supplied null from a null manufactured by faulty browser conversion. Input validation must preserve that distinction before serialization.

Age influences existing demographic presentation and downstream age-based checks. This batch does not establish new clinical age bands, validate clinical rules, or decide whether supplied demographic facts are true.

## Independent expected semantics

- Accept an explicitly supplied finite whole-number age within the existing permitted range, including zero. Accept the intentionally supported nonblank numeric text from entry forms only after validating its type and value; do not infer a value from missing input.
- Reject booleans, arrays, objects and null as registration age values. Blank/whitespace input must remain absent or invalid according to the form boundary; it must never become zero. The ordinary age-or-birth-date prerequisite must still reject an otherwise missing age. Preserve the governed emergency registration exception without manufacturing demographics.
- In the correction interface, invalid, fractional, out-of-range or non-finite age text must show an actionable error and send no correction request. Keep the existing deliberate `NULL` clearing instruction distinct from invalid text and from cancellation.
- Preserve omission of unchanged fields, explicit zero, and permitted intentional clearing. A cancelled prompt must not write or complete a request. A valid date-of-birth correction and a valid estimated-age correction must retain the existing mutually exclusive storage behavior.
- Preserve inherited numeric-string compatibility, including JavaScript hexadecimal/scientific representations; this patch does not claim a plain-decimal-only format policy.
- Preserve existing field-specific bounds unless a separately reviewed requirement changes them. At this baseline registration permits 0–120 and the controlled correction API permits 0–130; this review records that difference rather than inventing a harmonized clinical standard.
- Preserve facility and role isolation, identity evidence, correction reason, before/after fingerprints, named actor/session, and atomic request completion. No historical record, prior audit event or previously completed request is silently repaired or reclassified.

## Verification requirements and bounded initial results

| Scope | Independent acceptance evidence to retain |
| --- | --- |
| Regression | Show the relevant malformed inputs failing expectations on the old behavior and passing after correction. Expectations must name intended values and write counts, not merely mirror the parser. |
| Registration API | Synthetic valid zero and ordinary integer/text cases; malformed type/blank cases; missing-age ordinary registration; emergency omission; authorized foreign/unauthorized cases. Rejected input creates no patient, consent, registration audit or related visit/queue state. |
| Correction browser/API | Invalid text never reaches the mutation endpoint or clears age. Deliberate permitted clearing and valid age correction preserve exact intended values; cancel leaves the record unchanged. Verify actual request serialization and persisted outcome, not only a success banner. |
| Integrity/failures | Preserve the patient and in-review request on validation/authorization/audit failure. Check retained actor, session, facility and before/after audit evidence on success. Distinguish mocked rejection from independently demonstrated real database rollback. |
| Presentation | Error visibility, retained correction context and keyboard recovery; relevant desktop/phone behavior. Do not claim redesigned forms or print layouts when unchanged. |
| Release | Reserve the candidate version, freeze the full SHA, obtain all available agents' assigned final-source reviews/retests and exact-source CI, then retain archive, build and deployment evidence if an authorized release proceeds. Any substantive later edit invalidates approval of the affected scope. |

Initial implementation checks passed 921 unit tests across 117 files, types, 55 migration checks, zero production dependency vulnerabilities, the complete 158-check browser-hold fixture and seven affected browser scenarios. Both new registration test sets first failed 24 malformed-input cases against the original behavior. The four new browser/API scenarios verify blocked mutations, saved zero versus null, actor/facility/session and request audit links; API-read evidence is distinct from direct SQL rollback evidence. Final frozen-source all-agent retests, full browser regression and exact-source CI remain required; initial success is not deployment approval. Final identities/results belong in the workflow log and candidate evidence. No schema/provisioning change is intended; verify the final diff before using the application-only release procedure in [OPERATIONS](../../OPERATIONS.md).

## Assessment mapping and retained boundaries

### Amendment after independent actual-form review

The first candidate `d91e705` passed 921 unit tests and 129 browser scenarios, including API-only emergency omission, but independent use of the actual registration form failed: blank optional names, phone and subcounty reached the server as invalid empty strings. The uncontrolled county default could also survive route changes without staff confirmation. Those results supersede the initial release approvals.

The amendment serializes blank optional form fields as omitted facts, preserves explicit zero and entered location, removes the automatic county, and permits an absent emergency sex through the existing server `UNKNOWN` default. Standard and guardian validation remain enforced. Four helper tests pass with the full amended 925-test suite; the additional actual-form browser scenario requires saved zero and unknown age through subsequent authenticated HTTP reads. These reads are not independent direct-SQL or consent/audit verification. Existing route and fixture tests retain their separate authorization, facility and attribution scope.

One browser attempt failed an accessible-label locator; it was corrected to the combobox role/name without weakening expectations. The next run was blocked before reaching browser tests by the strict concurrent goods-receipt fixture assertion. An earlier coordinator run failed the purchase-order counterpart. Neither failure is dismissed by later successes. Synthetic responses now print before best-effort database diagnostics, so a failed diagnostic query cannot mask the original assertion. Aggregated application error codes are contextual evidence, not request-correlated causes. A bounded concurrency investigation and new frozen-source checks remain release gates.

This batch supports the existing [legal control matrix](MWEIN-LEGAL-CONTROL-MATRIX.md): **LEG-06** controlled and attributable corrections, **LEG-07** access controls, **LEG-08** action auditing, and **LEG-18** data quality and source-bound validation. Those rows remain partial; this is not a new legal interpretation or closure of their external acceptance requirements. The 73-route source classification is not evidence of every branch, authenticated session or operational retention control.

The official [DHA HIE go-live guide](https://hie-docs.dha.go.ke/docs/goLive), checked 16 October 2026 and marked last modified 28 September 2026, describes development/testing, successful UAT, DHA certification and subsequent production credentials as distinct phases. This local correction does not perform or replace those phases, activate national exchange, obtain credentials or authorize clinical use. Preserve the [HIE requirements register](DHA-HIE-REQUIREMENTS.md), MFA/readiness gates and accountable legal, clinical, security and recovery acceptance.

## Next bounded work, kept in the pipeline

1. Complete session attribution for queue and appointment mutation branches. Known omissions remain in queue pause/resume/call/start/transfer and appointment booking/rescheduling/status events; test each branch's exact actor, facility and authenticated session rather than relying on the source inventory.
2. Review supply retries with changed payloads. `src/app/api/supply/route.ts` compares request fingerprints for purchase orders and receipts, but other retained operation types return a replay after actor/facility/action checks without an equivalent payload comparison. Establish exact-retry versus changed-payload expectations before changing behavior; preserve historical-operation limitations and avoid silently claiming a changed operation succeeded.
3. Continue diagnostic responsibility/handover, pharmacy clarification, cashier/refund and attributable follow-up work, plus approved external compliance evidence. The demographic correction does not replace these requests.
