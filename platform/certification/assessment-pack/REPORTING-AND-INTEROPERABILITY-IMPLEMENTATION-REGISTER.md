# Reporting and interoperability implementation register

Accountable owner for this workstream: **Edwin Mbiti Chavulimu**, per the user’s instruction of 22 September 2026. Listed lead/reviewer roles describe delivery expertise, not separate accountable ownership.

Baseline reviewed against deployed source a5e19d3 on 22 September 2026; reporting permission/disclosure notes updated against remediation commit 99754d0. This records verified implementation boundaries and the remaining acceptance work; it does not enable national transport or select a legal classification.

The [DHA certification portal](https://certification.dha.go.ke/) includes public-health reporting and information exchange in assessment. The [official Kenya Core guide](https://fhir.dha.go.ke/ig/index.html) currently identifies version 1.0.0/FHIR R4 and a local-development-build label; domain guides extend the core. Confirm the accepted package/version with the intended receiving service before configuring it. This is reference discovery, not conformance certification.

## Current reporting semantics, from source

`src/app/api/reports/moh-monthly/route.ts` requires `reports.clinical` on the remediation branch and filters facility visits by arrival within Nairobi calendar-month boundaries, excluding cancelled visits. Attendance is visits, not unique patients. Age is computed at arrival and grouped into under 5, 5–14, 15–24, 25–49, 50+ or unknown. Diagnoses come from a selected signed encounter; totals count coded diagnosis rows. Laboratory/imaging counts are non-cancelled orders, not verified results. Medicines count qualifying prescription-order dispense states, not units dispensed. Referrals use sentAt within the period independently of the originating visit's arrival. The response declares REVIEW_REQUIRED; no KHIS submission/acknowledgement is established.

These definitions must not be relabelled as approved MOH indicators. The route uses current record state when regenerated; a historical snapshot/revision trail is not demonstrated by this endpoint alone. Review whether multiple signed encounters or duplicate codes should contribute differently to an approved dataset. The remediation branch now separates clinical report permission from billing and audits the disclosure with private/no-store responses; these changes still require production rollout.

## Action and acceptance matrix

| ID | Work required | Dependency | Concrete acceptance evidence |
|---|---|---|---|
| INT-01 | Confirm application classification and exact mandatory datasets/capabilities | Authoritative framework + portal list + accountable owner | Requirement-to-capability mapping with approved applicability decisions |
| INT-02 | Approve reporting dictionary | Current MOH/KHIS dataset package and health-records owner | Dataset/version, org-unit IDs, periods, disaggregations, counting rules, code lists and mappings |
| INT-03 | Implement/validate reporting lifecycle | INT-02 | Draft/review/approval, immutable submitted revision, correction linkage, zero reporting rules and reconciliation tests |
| INT-04 | Approve notifiable-event definitions and routing | Current national/county surveillance guidance + clinical/surveillance owner | Versioned conditions/case definitions, triggering data, timing, recipients, escalation and acknowledgement rules |
| INT-05 | Implement/validate notification and return workflows | INT-04 + approved recipient/transport | Synthetic suspected/confirmed cases, duplicates, overdue acknowledgement and corrections tested; no real notification sent in testing |
| INT-06 | Pin Kenya Core/domain profiles and identifiers | Receiving-service confirmation, registry authority | Package/checksum, canonical profiles, identifier namespaces and version policy |
| INT-07 | Validate patient/clinical mapping | INT-06 | Official validator output for positive/negative synthetic examples; terminology and required-field checks |
| INT-08 | Add approved transport controls | Authorized sandbox, credentials and contracts | Authentication, consent/provenance, retries/idempotency, error quarantine, genuine acknowledgements and audit results |
| INT-09 | Reconcile reports with source | INT-02, INT-03 | Fixed synthetic dataset covering month edges, repeated visits, unsigned notes, cancellations and corrections; reviewer agreement |

## Concrete mapping gaps

The baseline `src/lib/kenya-fhir.ts` builds a configurable Patient resource and rejects unidentified records. Configuration checks URL shape; this is not validation against an accepted national profile. The function includes facility code among Patient identifiers; verify the intended semantic mapping against the approved profile rather than assume facility identity is a patient identifier. No application call site for this converter was found in the scoped API/source search. Unit tests cover the helper, not end-to-end national exchange.

WHO ICD-11 search connectivity is separate from registry validation and HIE transport. An ICD-11 code alone is not an approved surveillance case-definition trigger. Do not introduce guessed code lists, notification deadlines, report dataset IDs, national patient identifiers or production endpoints.

## Authoritative input register

- Kenya Core: official guide above, accessed 22 September 2026; receiving-service acceptance not confirmed.
- DHA signed certification framework: known official PDF could not be retrieved during this review; no clause numbers invented.
- Current KHIS/MOH datasets and facility/org-unit mapping: not supplied.
- Current surveillance definitions and reporting forms: not approved for this project. The [KNPHI clinician handbook search source](https://www.nphi.go.ke/sites/default/files/2024-02/IDSR%20Clinicians%20Handbook.pdf) was located but its PDF fetch timed out; its currency/content were not used to implement rules.
- Sandbox credentials, receiving-service contacts and authorization: not supplied in this pack.

Engineering can proceed with implementation once these concrete contracts are verified. Until then, keep national submission disabled and accurately label local summaries.

## APP-08 / APP-09 requirements package

See [reporting and IDSR requirements](REPORTING-IDSR-REQUIREMENTS.md) for four workflow scopes, versioned input contracts, review/delivery controls, planned acceptance tests and an explicit pending-input register. Requirements are prepared; mappings, workflows and national transport are not implemented by this package.

Facility context supplied by the user: Busia County, Nambale Subcounty, MFL 31749; currently reports to the county, with no assigned surveillance officer. Registry verification, KHIS org-unit mapping and exact authorized county routing remain pending. Local workflow development can proceed with configurable contracts; no recipient or national mapping is inferred.

Local foundation update: [implementation and validation](../LOCAL-REPORTING-IMPLEMENTATION.md) now covers manual aggregate drafts, independent review, immutable approval and linked corrections. This does not change the monthly source endpoint into an approved national return or implement IDSR notifications.

Local IDSR follow-up: [implementation scope](../LOCAL-IDSR-IMPLEMENTATION.md) records case/event capture and reviewed history, including explicitly staff-recorded external contact and acknowledgement. This is partial INT-05; INT-04 authoritative definitions/routing, weekly returns, automated escalation and receiving-service transport/acceptance remain unfulfilled.
