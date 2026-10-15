# Reference review and production-readiness backlog

Reviewed 15 October 2026 at the user's request. Reference: [opensource-emr/hospital-management-emr](https://github.com/opensource-emr/hospital-management-emr), identifying itself as Danphe EMR. The read-only source review is pinned to **99638225ba0876261c2c16c3bd2f9b83f4abbc19** (2 September 2024). A local sparse clone was inspected without installing dependencies, executing its code or importing databases.

## What we can reuse

The [README](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/README.md) describes connected registration, appointments, billing, pharmacy/inventory, diagnostics, admission/discharge/transfer, nursing, clinical records and reporting. Its deployment claims are the project's own statements, not independent evidence of Mwein readiness.

The repository's [MIT licence](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/LICENSE) permits reuse subject to its notice requirements. This batch uses workflow concepts and original Mwein implementation; no source code or assets were copied. Retain licence/copyright notices if later work incorporates substantial portions.

The checked-in [frontend package](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/wwwroot/DanpheApp/package.json) uses Angular 7, and the [server project](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/DanpheEMR.csproj) targets .NET Framework 4.6.1. Keep Mwein's existing architecture and release controls. The reference's dependencies, sample configuration, integrations, demo credentials and build pipeline are not a production template for this app.

## First implementation: verified investigation handoff

The reference separates [pending laboratory results](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/labs/lab-tests/lab-pending-results/lab-tests-pending-results.component.ts) from [final reports](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/labs/lab-tests/lab-final-reports/lab-tests-final-reports.ts), with request identifiers, filters, report viewing and printing. This separation prompted an audit of Mwein's clinical disclosure boundary.

Mwein already restricted direct diagnostic-report reads to verified results, but its history, summaries and clinical visit worklist could return draft values. This batch aligns those clinical readers with `VERIFIED` plus a non-null verification time. Laboratory and imaging workbenches retain their own drafts under the corresponding write permission. Governed privacy exports remain separate.

Consultation → Investigations now includes a visit-scoped results panel with pending/specimen-rejected/cancelled states, released laboratory and imaging reports, verification attribution and recorded critical-result communication. Refreshing this panel preserves the consultation form. Loading and failed refreshes remove stale results; switching patients aborts superseded reads. The read endpoint requires `clinical.results.read`, filters by the current facility, audits disclosed visit/report IDs before responding, and uses private non-cacheable responses. The latest 200 investigations are shown with an explicit truncation notice.

History displays both laboratory and imaging results when present. Numeric laboratory trends use verification time and matching units, with the date basis explained to the reader. Neither the trend nor the panel invents reference ranges, diagnostic interpretation or clinical approval. Viewing a report is not a signed clinical acknowledgement. Existing sign-off and closed-visit mutation boundaries remain in place.

## Prioritised next work

These are a focused engineering backlog, not a claim of a complete audit of either system. Check `WORKFLOW_IMPROVEMENT_LOG.md` and Git history before implementing to avoid duplicating later batches.

| Priority | Workflow | Mwein next acceptance evidence |
|---|---|---|
| 1 | Consultation recovery | Warn before discarding unsaved changes; prevent concurrent draft overwrites with revision checks; recover confirmed saves after lost responses without persisting clinical notes in ungoverned browser storage. Test switching patients, reloads and closed visits. |
| 2 | Diagnostic follow-through | Design explicit clinician acknowledgement, ownership and escalation for outstanding results, including handover and clinically closed visits. Agree the clinical policy before enforcing new sign-off rules. Opening the panel is not acknowledgement. |
| 3 | Pharmacy continuity | Audit existing partial dispensing, stock shortages, substitution approval and return-to-clinician flows; reconcile balances and histories under retries/concurrency. Do not infer medication equivalence from the reference catalogue. |
| 4 | Cashier and discharge | Audit partial settlement, refund/reversal approval and shift reconciliation. Preserve independent clinical closure and financial settlement. |
| 5 | Follow-up resolution | Add attributable contact attempts/outcomes and links to subsequent care; distinguish outreach from successful completion. Review consent and role boundaries. |
| 6 | Inpatient workflow | Use the reference's ADT/nursing module scope to specify bed occupancy, transfers, nursing tasks and discharge reconciliation with ward staff. Require concurrent bed-allocation and medication reconciliation acceptance before clinical use. |
| 7 | Operations and integration | Verify deployment identity, branch protection, monitored recovery, immutable audit retention and approved identity-provider behaviour. National reporting/HIE/payer integrations require current contracts, mappings and tested credentials. |

## Primary-source context

- [HosiPoa modules](https://hosipoa.co.ke/modules/), reviewed 15 October 2026: connected departments and diagnostic workflow scope inform the backlog; public marketing descriptions are not clinical specifications.
- [WHO laboratory quality manual template](https://www.who.int/publications/m/item/laboratory-quality-manual), published 2014 and reviewed 15 October 2026: the template includes specimen acceptance/rejection, results validation, critical-result reporting and document control, and calls for local adaptation. These topics guide engineering questions; this implementation does not establish laboratory accreditation or conformance to a current standard.
- [Kenya Ministry of Health digital reform update](https://www.health.go.ke/government-scales-digital-health-reform-drive-accountability-and-efficiency), reviewed 15 October 2026 via the primary site's indexed text after the direct fetch timed out: accountability and continuity are relevant context. This news article is not an interoperability contract, legal determination or approval of Mwein.

## Production release remains evidence-based

Follow `OPERATIONS.md` and the existing release gates. Required external evidence includes clinical and finance acceptance, independent security review, approved identity/MFA configuration, retained backup/restore and audit evidence, realistic PostgreSQL migration/concurrency rehearsal, physical-printer UAT and an approved release/source identity. Branch protection must require Platform verification in GitHub; committing the workflow alone does not enforce it. `/api/ready` is a readiness probe, not a traffic-admission system.

No production deployment, real patient data processing, external messaging or new clinical standard was introduced. Test counts and artifact paths for this batch are recorded in `WORKFLOW_IMPROVEMENT_LOG.md`.
