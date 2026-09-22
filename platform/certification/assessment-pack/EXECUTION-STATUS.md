# Items 1–4 — execution status, 22 September 2026

Work completed below is preparation and technical verification. The four workstreams are not all closed; corporate evidence, specialist acceptance and receiving-system requirements remain dependencies.

| Item | Completed now | Still required |
|---|---|---|
| 1. Ownership and scope | Edwin Mbiti Chavulimu assigned accountable ownership across all workstreams; Charles retained as data-protection contact. CR13/business search reviewed and lists Edwin as proprietor | Final scope decision, qualified reviewer/deputy arrangements and assessment approvals |
| 2. Corporate/privacy/infrastructure evidence | Application-specific DPIA/risk/procedures draft; processor/retention/notice work; recovery and incident run cards; live deployment metadata and version probes | Tax PIN/TCC now received (EV-15/EV-16); live validation and remaining applicant-specific documents pending, Edwin-accountable privacy approval with Charles's review, actual processing regions/contracts/key evidence, independent backup target and measured restore |
| 3. UAT and identity gap | Fresh isolated release checks passed: 239 unit tests, 28 browser scenarios, type checking, 43 migrations; browser visual check passed; technical outputs retained | Clinician-led UAT, clinical/finance/privacy signatures, capacity/accessibility acceptance; MFA remains paused |
| 4. Reporting/interoperability | Verified monthly-report semantics; identified access/mapping gaps; official Kenya Core reference checked; nine implementation/acceptance actions documented | Current approved datasets/case definitions, selected classification, accepted profiles, authorized sandbox/transport and actual conformance/acknowledgements |

## Fresh technical evidence

See [retained evidence manifest](technical-evidence-20260922/manifest.json), [unit results](technical-evidence-20260922/unit-tests.txt), [browser results](technical-evidence-20260922/browser-tests.txt), [migration checks](technical-evidence-20260922/migrations.txt), [type check](technical-evidence-20260922/typecheck.txt) and [visual check](technical-evidence-20260922/browser-visual-check.txt).

The browser harness built the production-mode application from the isolated deployed source and exercised its synthetic API/database setup before the 28 scenarios. A separate held fixture supported the visual check. Tests do not establish clinical approval, live WHO UI use, official FHIR conformance or an independent recovery drill. No native MFA files or migration were included. No application code was changed or deployed.

At 16:26 UTC, [live probes](technical-evidence-20260922/live-probes.json) confirmed HTTP 200, database connectivity and exact source/migration match; readiness remained HTTP 503/blocked. [Deployment inspection](technical-evidence-20260922/deployment-inspection.txt) reported Ready and iad1 for the listed functions. This does not establish all data locations, database residency or contractual safeguards.

## Open findings requiring closure

- DPO definition exists, but baseline staff administration omits DATA_PROTECTION_OFFICER from assignable roles and governance-role classification. Assigning Charles in this document does not provision a live account. Resolve the entire authorization path with tests before live DPO onboarding; do not reuse administrator credentials.
- Monthly clinical aggregates currently use billing.read. Review minimum access and read-audit controls with Charles; local operational summary is not an approved KHIS dataset.
- FHIR Patient helper uses facility code in Patient identifiers and has no application call site identified by the scoped source search. Validate profile semantics and actual integration before claiming exchange readiness.
- AI library/configuration exists but no application generator call site was found in the scoped baseline search. This supports the proposed exclusion; it is not independent runtime assurance.
- Restore script compares URL strings, which cannot alone establish distinct database identity. Independently verify the disposable target before any restore.

## Immediate handoffs

Edwin is accountable for all remaining actions: finalize scope, confirm live tax validity and any remaining applicant-specific documents, coordinate qualified clinical UAT and privacy review with Charles, collect provider controls, arrange the independent restore drill, and obtain authoritative reporting datasets/profile contracts/sandbox authorization. The CR13/business-search receipt and review are complete; final approvals are not.


## Tax evidence received

[EV-15/EV-16](TAX-EVIDENCE-REVIEW.md) now record Edwin’s KRA PIN certificate and TCC. Their taxpayer name and PIN match; the TCC states expiry on 12 November 2026. They are received/visually reviewed, not independently registry-verified or DHA-accepted.
