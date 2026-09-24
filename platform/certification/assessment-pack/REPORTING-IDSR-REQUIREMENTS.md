# Reporting and IDSR requirements — APP-08 / APP-09

Prepared 22 September 2026. Status: engineering requirements draft; authoritative dataset, clinical rules and receiving-service approval pending. Source reviewed: remediation commit `99754d0`; this is not a statement about deployed functionality. Edwin Mbiti Chavulimu remains accountable for this workstream. Clinical/surveillance expertise and receiving-service approval must be arranged separately; ownership does not confer clinical qualifications. Charles Karani remains the data-protection contact.

## Facility context supplied by the owner

The user confirmed **Busia County**, **Nambale Subcounty**, **MFL code 31749**, no assigned surveillance officer yet, and a current practice of reporting to the county. These are user-supplied details, not independently verified registry information. The corresponding KHIS organization-unit identifier and facility dataset assignments remain unknown; do not substitute 31749 as a KHIS ID.

Use a configurable county reporting destination for the proposed workflow. Keep the exact authorized county recipient, channel, backup contact, response expectations and escalation timings pending. An assigned individual officer is not a prerequisite for developing local drafts, review queues, revision history or a manual-delivery evidence register. Operational routing still needs a verified recipient/channel and approved protocol; do not invent contact details or mark a report delivered merely because the destination says “Busia County.”

The next implementation can build the local draft/review/revision foundation and manual case/event capture with synthetic test dictionaries. Display dataset configuration as pending until approved metadata is available. Keep case/event review separate from routine-return approval, preserve the ability to document action through the facility's established reporting process, and make no automated national submission or disease-trigger claims. Facility details belong in per-facility configuration, not hard-coded rules for every app customer.

## What the app has and what is missing

| Capability | Evidence from current source | Remaining work |
|---|---|---|
| Monthly local summary | `src/app/api/reports/moh-monthly/route.ts`; facility scope, Nairobi month boundaries, visits/diagnoses/service counts, REVIEW_REQUIRED | Approved dataset dictionary, deterministic counting rules, review, frozen revisions and corrections |
| Restricted report access | Remediation uses `reports.clinical`, audited disclosure and private/no-store responses | Provision permission map during rollout; dedicated reporting preparation, review and submission permissions |
| Clinical source data | Patient, encounter, diagnosis, laboratory, referral and audit records exist | Define reportable episode, onset/detection timestamps, surveillance classification, relevant exposure and outcome fields against approved forms |
| Weekly IDSR | No dedicated return workflow found | Versioned weekly dictionary, epidemiological calendar, cases/deaths, zero vs missing reports, validation and submission history |
| Urgent case notification and unusual-event reporting | No completed surveillance workflow found | Manual signal/case recording, priority queue, recipients, timing, escalation, updates and acknowledgements |
| Delivery scaffolding | `ExchangeSubmission` schema has payload/hash, idempotency, attempts and acknowledgement fields; no use in `src` found | Reviewed transport implementation, access controls, authenticated receiving-service contract, retry/reconciliation and real sandbox evidence |

The existing monthly endpoint counts visits rather than unique patients, coded rows from one selected signed encounter, non-cancelled laboratory/imaging orders rather than verified results, and dispensed medication orders rather than units. It selects the first signed encounter without an explicit encounter ordering. These are local summary semantics, not approved national indicators. Do not reuse them as surveillance case counts. Financial reports do not establish public-health reporting capability.

## Source authority and limits

Sources checked 22 September 2026:

- The [DHA certification portal](https://certification.dha.go.ke/) identifies notifiable diseases, weekly IDSR, public-health events and routine returns within reporting/public-health assessment. This establishes the areas to address; applicability and assessor tests still require the applicant-specific checklist.
- The [KHIS Aggregate portal](https://hiskenya.dha.go.ke/dhis-web-commons/security/login.action) identifies the aggregate reporting service. A public login page does not establish this facility's assigned datasets, organization-unit IDs, API access or submission authorization.
- The KNPHI-hosted [Clinician’s Handbook](https://www.nphi.go.ke/sites/default/files/2024-02/IDSR%20Clinicians%20Handbook.pdf) search index identifies MOH 502 for case-based reporting and MOH 505 for weekly summaries. The full PDF fetch timed out; its indexed publication is old. These form numbers are discovery leads only, not confirmation of the current form revision, condition list or deadlines.
- A [KNPHI 2025 public-health emergency decision framework](https://www.nphi.go.ke/sites/default/files/3.%20Decision%20Making%20Tool%20for%20Public%20Health%20Emergencies_Kenya_Framework_2025%20.pdf) search excerpt references Kenya IDSR Technical Guidelines, third edition, and disease-specific guidance. Obtain the actual applicable guidelines and updates before configuring clinical triggers.
- The [surveillance FHIR guide, version 0.1.0 CI build](https://build.fhir.org/ig/IntelliSOFT-Consulting/Surveillance-FHIR-IG/branches/jk-docs/functional-requirements.html) explicitly says it is not an authorized publication. Its immediate-reporting row mixes immediate and periodic concepts. Treat it as discovery material, not an accepted transport or timing contract. No rule requiring laboratory confirmation before an urgent alert is adopted from it.

No disease thresholds, statutory deadlines, national endpoint addresses or epidemiological-week algorithm are asserted by this draft. The requirements below are proposed engineering controls, not quotations of an approved national specification.

## Four workflows to implement

| ID | Workflow | Required behavior | Input still needed |
|---|---|---|---|
| RPT-01 | Routine aggregate returns | Select approved dataset/version and period; derive a draft with source provenance; reconcile; review; freeze an approved revision; export/submit; retain response and correction history | Assigned forms, data elements, category options, facility org-unit mapping, deadlines and counting dictionary |
| RPT-02 | Weekly IDSR return | Explicit epidemiological year/week and start/end; approved condition rows and case/death categories; distinguish missing data from an attested zero return; reconcile case-linked and manually entered totals without double counting | Current weekly form, week calendar/year boundary, condition/classification rules, submission deadline and zero-report policy |
| RPT-03 | Urgent case notification | Authorized clinician/focal person can record a suspected reportable case for prompt action; retain onset, detection, notification and updates separately; route using approved urgency rules; track recipient acknowledgement | Current case definitions, suspected/probable/confirmed rules where applicable, timing basis, required fields, contacts and channels |
| RPT-04 | Unusual event/signal | Record a cluster or public-health signal even without an identified patient or final diagnosis; triage, link related cases, route, update and close with reason | Approved event types, triage responsibilities, escalation paths and minimum signal details |

Urgent notification must have a separate path from periodic report approval. Its approved protocol must not make billing, discharge, a signed encounter, a completed weekly return or laboratory confirmation a universal prerequisite. A manual reportable concern must remain possible even when automated mapping is unavailable. An ICD-11 match may support review only after an approved mapping; it is not by itself a case definition or permission to transmit.

## Required configuration contracts

Each contract needs a stable ID, version, authoritative source/reference and checksum where available, effective dates, reviewer identity/role, approval evidence reference and supersession history. Unknown values remain unset. Templates and environment variables are not approval evidence.

| Contract | Mandatory contents before operational activation |
|---|---|
| Facility | Internal facility ID; verified MFL code; county/sub-county; receiving system and organization-unit ID; verification source/date. Do not assume MFL code equals KHIS org-unit ID. Configure per facility. |
| Routine/weekly dataset | Form name/version; dataset ID; element and category IDs; types/units; numerator/denominator where relevant; case/visit/person/episode counting basis; age reference date; sex/unknown handling; inclusion/exclusion; duplicate and late-data policy; period calendar; cutoff; zero/missing rules; validation formulas |
| Condition/event definition | Versioned authoritative definition; suspected/probable/confirmed/discarded applicability; required clinical/lab/exposure data; mapping terminology/version; onset/detection reference; threshold rules if applicable; permitted overrides and clinical approval |
| Routing and timing | Designated primary/backup recipients; approved channels; trigger/start time; deadline calculation; acknowledgement target; escalation order and out-of-hours fallback; outage procedure; effective dates. Protected contact details stay outside Git. |
| Delivery | Authorized environment/endpoint; credentials reference; payload/profile version; idempotency and correction semantics; response states; evidence required for acknowledgement; retry/timeout/rate policy; reconciliation and retention |
| Accountability/access | Named preparer, qualified clinical/surveillance reviewer, submitter and backup; facility-limited permissions; shortage-cover scope, reason, start/expiry and authorizer; independent retrospective review where approved |

Edwin arranges completion and sign-off; no live account is automatically granted all these permissions. Existing clinician coverage for vitals/billing/discharge does not automatically grant surveillance export or national submission. Proposed permissions separate view, prepare, clinical review, submit, route administration and audit. Finance-only access must not reveal case-level data. DPO oversight does not automatically authorize clinical classification.

## Records, state changes and integrity

Implementation should separate an aggregate report revision, a surveillance case/event revision and delivery attempts. Reuse `ExchangeSubmission` only after verifying its constraints; its existence does not satisfy these requirements.

- Aggregate identity: facility + dataset/version + period + revision, with collection cutoff, source release/schema, source record/version references, dictionary hash and payload hash. Freeze source values needed to reproduce totals under approved retention rules. Store identifiers securely; do not place patient details in operational logs.
- Report workflow: DRAFT → IN_REVIEW → APPROVED. A reviewer may return a draft with reasons. Material edits invalidate review. Use atomic transitions and optimistic concurrency. Each approval records actor, role, timestamp and revision hash.
- Corrections: create a new revision linked to its predecessor with a reason; retain the historical approved/submitted payload and all responses. Never silently recalculate or overwrite a submitted return when source clinical data changes.
- Case/event record: distinguish signal status, clinical classification and delivery status. Preserve who changed classification and why, and link duplicate episodes without silently deleting them. Support unidentified cases and non-patient events subject to the approved minimum dataset.
- Delivery workflow: queued/attempting, receipt pending, accepted or rejected, and unknown outcome after a timeout. Successful HTTP transport or a local “sent” click is not receiving-service acceptance. Record the service's actual receipt/validation evidence. Permit partial-item outcomes if the contract uses them.
- Retries: stable idempotency key per destination and revision; new revision means a new key. Reconcile unknown outcomes before resending when the destination cannot guarantee idempotency. Reject duplicate workers or stale state transitions atomically.
- Manual approved channel: retain notifying person, time, recipient/channel and protected evidence reference. Label manually recorded acknowledgement separately from machine-verified receipt. Internal timeout alerts are not evidence of external delivery.
- Audit and privacy: facility scope on every read/write/export; least-privilege case disclosure; immutable audit events for review, override, correction and delivery; no-store responses; no clinical payloads in generic errors or logs. Approve lawful basis, minimum necessary fields, retention, encryption and recipient authority before transmission.

## Acceptance tests required before release

All fixtures must be synthetic. This list is planned acceptance work, not completed test evidence.

| Test | Expected result |
|---|---|
| AT-01 Unknown/expired dataset or unverified facility mapping | No operational submission; precise missing-input message; local draft retained |
| AT-02 Nairobi period edges, leap day and epidemiological year crossover | Exactly the approved interval; no guessed ISO-week substitution |
| AT-03 Repeat visit, duplicate diagnosis, multiple encounters and corrected lab result | Counts match approved episode/indicator rules; stable, reproducible selection |
| AT-04 Missing report, unknown field and confirmed zero activity | Distinct states; zero report requires authorized confirmation, not an empty-query shortcut |
| AT-05 Review, edit during review and concurrent approval | Stale review rejected; payload cannot change after approval; revision hashes match |
| AT-06 Correction after submission | New linked revision; historical payload/receipt unchanged; totals reconcile |
| AT-07 Suspected case and unidentified patient | Authorized urgent workflow follows approved minimum fields without waiting for billing/discharge or universal lab confirmation |
| AT-08 Cluster without patient and duplicate signal | Event captured; related records linked; review resolves duplication with an audit trail |
| AT-09 Recipient unavailable, overdue acknowledgement and outage | Approved fallback/escalation used; separate detection, notification and receipt times preserved |
| AT-10 Retry, timeout, rejected item and duplicate callback | No false acceptance or duplicate count; genuine response linked to exact revision; replay rejected |
| AT-11 Cross-facility/finance-only access and expired cover | Access denied server-side; no case payload leaks; only authorized, time-limited coverage works |
| AT-12 Assessor demonstration | Frozen synthetic cases/returns, traceable totals, correction history, delivery evidence and signed specialist review |

## Work order and outstanding decisions

1. Complete the input register below and pin received authoritative documents/metadata in protected evidence storage. Preserve public source links and checksums in the project; no credentials or personal contact details in Git.
2. Build the local draft/review/revision foundation with synthetic dictionaries. It may be developed before national contracts arrive, but must remain clearly labelled local/unconfigured and cannot claim MOH/IDSR conformance.
3. Implement approved routine/weekly mappings, period rules and reconciliation. Obtain health-records reviewer agreement on expected totals.
4. Implement approved case/event definitions, urgency and escalation with a qualified clinician/surveillance reviewer. Do not let routine approval delay required urgent action.
5. Integrate the authorized sandbox channel, test receipt/retry/correction semantics, obtain independent acceptance evidence, then separately authorize production activation.

| Input | Status | Responsible follow-up |
|---|---|---|
| County, sub-county, verified facility MFL and KHIS org-unit | User supplied Busia / Nambale / MFL 31749; registry verification and KHIS org-unit mapping pending | Edwin / facility records lead |
| Current assigned routine and weekly forms with metadata export | Not supplied | Edwin / health-records lead and KHIS administrator |
| Applicable national IDSR edition plus current disease updates | Full authoritative package not obtained | Edwin / qualified surveillance reviewer |
| Designated surveillance officer and primary/backup routing | User reports to county; no assigned officer. Exact county recipient, channel and backup not supplied | Edwin / Busia County surveillance service |
| Calendar, cutoffs, notification timing and zero-report rules | Not approved | Receiving service and surveillance reviewer |
| Clinical reviewer, reporting preparer/submitter and shortage cover | Not assigned/approved for this workflow | Edwin |
| Applicant-specific DHA reporting test cases | Not obtained | Edwin / DHA applicant portal |
| Sandbox, authorization and acknowledgement/correction contract | Not supplied | Receiving service / integration owner |

The requirements package itself introduced no runtime changes. Subsequent local foundation implementation on `codex/dha-control-remediation` now adds manual aggregate drafts, review/return/approval, immutable approved revisions, linked corrections, facility-scoped permissions and auditing. See [operations instructions](../../OPERATIONS.md#local-reporting-draftreview-release). This addresses part of RPT-01 only. It does not implement RPT-02/03/04, approved indicator mapping, automatic source reconciliation, county routing or submission. APP-08 remains partial. The subsequent [local IDSR register](../LOCAL-IDSR-IMPLEMENTATION.md) adds case/event capture, review and manual notification history for part of RPT-03/04; APP-09 is now partial. National definitions, escalation and transport remain pending. MFA remains paused; no production migration or deployment has been performed.
