# DHA application controls — implementation record

Branch: `codex/dha-control-remediation`. Based on the reviewed deployed app plus evidence commit `adc0dc4`. This is implemented source, not a production release or DHA approval. The original workspace's paused MFA work is excluded.

## Implemented

1. DPO appears in assignable roles and is treated as a protected governance role. HR cannot assign/change/reset/disable DPO accounts without governance authority. Staff changes carry facility/session attribution and revoke affected sessions. Staff form retains its form element across asynchronous saves.
2. Appointments, dispensing details, patient problems, referrals, monthly reports and operational reports append disclosure audits before returning data. New records retain actor/session/facility and result fingerprints rather than copying patient identifiers or report content. Errors fail closed. Sensitive handlers use explicit private/no-store responses; the API proxy and error helper also apply no-store. Existing privacy, identity and discharge audit paths remain recognized.
3. Clinical and operational report permissions are separate from billing. Reporting navigation and panels honor the same permissions. Billing/cover roles retain invoice/payment functionality without facility-report access. A scoped provisioning script requires explicit approval of the documented role map; no live user assignments or permission changes were performed.
4. Restore tooling validates an independently approved disposable-target plan, normalized source/target identity, backup checksum, expiry and both live PostgreSQL system identifiers before invoking restore. Missing/ambiguous/shared system identity fails closed. Connections are supplied through protected environment rather than logged. The real recovery drill remains pending.

Audit inventory now lists all 63 API route files. It detects direct/delegated audit calls in reviewed sensitive families, pins the reviewed no-disclosure retired route and leaves other route families explicitly unclassified. Static call detection is a check, not complete runtime audit assurance; remaining classifications are separate follow-up work.

## Rollout and limitations

No database schema migration or MFA change. Review the role map and use the scoped reporting-permission runner before/with application rollout; see [operations](../OPERATIONS.md). The existing DPO definition must be provisioned; no person is assigned merely by appearing in the ownership documents.

Operational reports remain aggregate facility/finance/staff reports, not approved KHIS/IDSR submissions. National exchange remains disabled. DPIA/encryption/retention evidence, genuine recovery testing, clinical sign-off, independent security assessment and national conformance remain certification dependencies. APP-07 reproducible evidence generation is outside the user's requested items 1–4 and remains open.

## Verification

- Final unit run: 281 tests passed across 66 files, including disclosure failure/denial, DPO governance, audit scanner regression, restore guard and simulated subprocess ordering tests.
- Type checking passed. Production build passed through the browser harness.
- Full browser suite: 32 scenarios passed. A later expanded DPO form scenario exposed a collapsed-panel selector issue and the existing asynchronous form-reset defect; after fixing the form and targeting the visible status message, its final focused run passed.
- Migration verifier: 43 migrations and database constraints passed; no migration was added.
- Static inventory: 63 routes, zero missing audit-call candidates in reviewed sensitive families; 36 other route files remain explicitly unclassified. This is not a claim that all application reads have runtime audit proof.
- No actual PostgreSQL restore was executed. Process-boundary tests use simulated psql/pg_restore tools; genuine provider permissions, target identity and measured recovery remain to be evidenced.

Reviewed React changes preserve hook order, avoid unauthorized report fetching, retain labels and make no new client-side secret available. Server permissions, rather than button visibility, enforce authorization.

The final synthetic finance-manager report screen was inspected with agent-browser/Chrome: operational controls and data rendered, the clinical monthly panel was absent, and the browser error collector returned no entries. The temporary fixture and browser were stopped after verification.
