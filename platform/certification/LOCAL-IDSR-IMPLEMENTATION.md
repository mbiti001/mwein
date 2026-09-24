# Local IDSR register — implementation scope

Implemented on `codex/dha-control-remediation`, 22 September 2026. This is a local surveillance capture and review foundation for APP-09/RPT-03/RPT-04. It is not an approved national case-definition engine, weekly IDSR return or receiving-service integration.

## Staff workflow

The **Local IDSR** work area is available to the proposed surveillance roles: nurses, clinicians, shortage-cover clinicians and medical directors. All can read and record facility concerns; only the medical director role can mark local review, close/reopen a concern or link a reviewed duplicate. Neither finance nor facility-administration access alone grants case-level surveillance access. The role map is proposed for rollout; it does not assign a medical qualification or create user appointments.

Staff can capture a case concern with or without an identified patient, or an unusual event/cluster without a patient link. Fields include observed concern, description, location, detection time, optional onset time and a staff-selected local priority. The register does not require billing, a signed encounter, discharge or laboratory confirmation. There are no invented disease classifications, clinical thresholds, code-based triggers or reporting deadlines. Unassessed priority must be resolved before recording local review, but review is not a prerequisite for documenting an external notification.

A linked patient must belong to the authenticated facility. Optional patient search uses the existing audited, permission-controlled patient search. Details can be corrected while open/reviewed; saving changes returns local status to OPEN and retains the previous reviewed snapshot. CLOSED details require explicit reopening. A reviewer can link a duplicate to a different original record in the same facility; history remains and cycles are rejected by disallowing a duplicate as the original target. Reopening clears the current duplicate link while retaining the historical decision.

## Manual notification evidence

The app does not send anything. Staff may record a notification already attempted through their established channel: recipient/office, time, phone/paper/other established channel, staff-reported outcome and protected evidence reference. The outcome distinguishes attempted contact from staff-reported delivery. Neither state means machine-verified county acceptance.

A staff-reported acknowledgement references a specific notification entry on the same record and cannot predate it. Recording it does not imply receiving-system verification or change the local clinical review status. Correction/context notes reference an existing history entry; the original notification and receipt entries remain intact. These annotations do not silently rewrite or automatically invalidate prior evidence; reviewers must read the referenced correction in the history.

All notification/acknowledgement entries explicitly retain `STAFF_RECORDED_ONLY` assurance. Operational transmission is `DISABLED`, and national rules remain `UNCONFIGURED`. The register must not be used as a reason to wait before taking action through the facility's established urgent reporting process.

## Integrity, privacy and access

`SurveillanceRecord` holds the current facility-scoped view and optimistic version. Every capture, detail change, review, duplicate decision, contact record, acknowledgement and annotation creates a `SurveillanceEntry` with a snapshot, actor, reason, version and canonical SHA-256 digest. Database triggers prohibit updating or deleting history. A transaction commits the current view, history and facility audit together; stale/concurrent updates fail without partial success. General audit logs receive hashes and fixed action names, not concern descriptions, patient identifiers or recipient details.

Reads are audited before disclosure and use private/no-store responses. List access supports status/priority filters and cursor pagination with 50 records per page, ordered by creation time. Detail access currently returns the full history for one record. Dates in the interface use Nairobi time; future observation/contact timestamps are rejected. There is no automatic urgency inference, time-based escalation, background job, external endpoint configuration or export endpoint.

## Rollout and remaining work

Apply `20260924110000_local_surveillance` through the reviewed migration/recovery process. Review the role map, then run `APPROVE_SURVEILLANCE_ROLE_MAP=true node scripts/release-surveillance-permissions.mjs` only as part of an authorized release. This script provisions three permission definitions and their role grants; it does not assign users or change credentials. Do not run the full bootstrap against production. No production migration, provisioning or deployment was performed during implementation.

User-supplied facility context remains Busia County, Nambale Subcounty and MFL 31749, with reporting to the county and no assigned surveillance officer. It is not hard-coded for all facilities and remains subject to registry/KHIS mapping verification. Required follow-up: designated county primary/backup recipient and approved channel; applicable case definitions and forms; timing/escalation protocol; qualified clinical/surveillance acceptance; national dataset and receiving-service contract; real sandbox acknowledgement evidence. Weekly IDSR and automatic aggregation remain separate outstanding work. MFA stays paused.

## Verification

Synthetic fixtures were used throughout the implementation checks below. No genuine public-health notification is sent by these tests.

- 309 unit tests across 71 files passed, including surveillance timestamp, facility access, patient linkage, acknowledgement linkage, stale-edit and disclosure-audit checks.
- Type checking and production build passed.
- All 45 migrations applied to the disposable test database; direct modification/deletion of surveillance history was rejected.
- All 39 browser scenarios passed in the full suite. The five added scenarios cover event capture, notification before review, manual acknowledgement, correction notes, local review, concurrent changes, closure/reopening, unidentified cases, duplicate-cycle rejection and denied access for finance/facility-admin/system-only accounts.
- The disposable synthetic outpatient fixture also passed its existing workflow checks. Agent-browser visual inspection confirmed the nurse workspace, navigation and form render without browser errors or framework overlays.
- Audit inventory now includes surveillance: 65 routes inventoried, zero missing audit-call candidates in reviewed families, 36 routes still unclassified. This is not a claim of complete application audit coverage.
- All 25 original paused MFA draft files retained their recorded SHA-256 hashes. No production access grants, migration, deployment or public-health transmission occurred.
