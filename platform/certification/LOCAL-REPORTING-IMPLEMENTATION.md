# Local aggregate reporting foundation

Implemented on `codex/dha-control-remediation`, 22 September 2026. This is part of APP-08/RPT-01, not completion of weekly IDSR or a national integration.

## Delivered behavior

Reports now includes a local aggregate worksheet with a source/register reference, editable indicators and counts, monthly selection, saved drafts and revision history. Missing counts stay missing. Explicit all-zero confirmation is required before an all-zero worksheet can enter review. Duplicate indicator names, invalid counts and contradictory zero claims are rejected.

A preparer requests review after resolving missing values. A reviewer may return the draft with a reason or approve it. Every contributor to the payload is retained; none may approve that revision. A correction inherits contributors as well as source values. An approved record is frozen, including its review note and reviewer/time. Corrections receive a new ID/revision and link to the predecessor. Only one successor may be created for each approved record.

`LocalReportRevision` stores the facility, report family, predecessor, optimistic version, status, month, JSON payload, SHA-256 fingerprint, contributors, preparation/review actors and timestamps. The payload fingerprint covers the fixed local contract, month and normalized payload. It does not attest to source-register truth or approved MOH definitions. A database trigger denies any update to approved records and any deletion of report history. Database constraints require approval evidence and reject a contributor as approver.

The API at `/api/reports/local` scopes reads and mutations to the authenticated facility. Read disclosures are audited before response; mutation and audit writes share a transaction. Responses forbid caching. Serializable mutations and version checks reject stale changes; uniqueness prevents competing corrections. Reads return at most 100 revisions for the selected month with an explicit truncation flag. There is no outbound transport or delete endpoint.

Preparation grants are proposed for FACILITY_ADMIN and MEDICAL_DIRECTOR; review only for MEDICAL_DIRECTOR. Clinical read permission remains separate from operations/billing. System-only, finance-only and ordinary shortage-cover accounts gain no local reporting access. The scoped provisioning script changes role definitions only; no user assignments or credentials were changed.

## Validation

- 297 unit tests across 69 files passed; type checking passed.
- All 44 migrations applied to a disposable PGlite database, including the new reporting migration. Direct attempts to overwrite or delete approved reporting history were rejected.
- A production build and the existing synthetic outpatient setup completed in the browser harness.
- New browser scenarios passed: draft with missing count, save, review, return, concurrent edits, independent approval, frozen-record rejection, linked correction, duplicate correction rejection, self-approval denial and finance-access denial.
- The full browser run passed 33 of 34 tests; an existing DPO test timed out on its role-label selector. Its selector was changed to the accessible combobox role, and all four affected access-control browser tests passed on focused recheck. All 34 distinct browser scenarios therefore have passing results across these runs.
- Agent-browser inspection verified the reporting screen and form render; no browser errors or framework overlay were detected.

## Remaining scope and rollout

No production migration, permission provisioning or deployment was performed. Apply `20260924100000_local_report_revisions` and the reviewed permission map as described in [operations](../OPERATIONS.md#local-reporting-draftreview-release) before activation. Assign an independent qualified reviewer; no shortage exception bypasses approval separation.

Busia County/Nambale/MFL 31749 remain user-supplied requirements context pending registry and KHIS mapping confirmation. This feature deliberately uses each authenticated facility rather than applying those details to every customer. County recipients, approved dictionaries, weekly calendars, case definitions, automatic source aggregation/reconciliation, urgent case/event workflows, escalation, national transport and receiving-service acknowledgements remain outstanding. Local approval never changes the descriptor `NOT_SUBMITTED`, and national dataset configuration remains `UNCONFIGURED`. MFA is unchanged and paused.
