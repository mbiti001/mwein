# Outpatient production consolidation — 25 September 2026

This release combines the history of outpatient commits `9f08cc0` and `1e779f7` with the newer live baseline `1beb4b4`. The merge deliberately retains the live implementation where the two branches solve the same problem.

## Resolution of overlapping work

- Retain the live disclosure helpers, global private/no-store response policy and source-bound audit inventory. They cover the earlier four outpatient fixes and the report/privacy fixes, plus additional endpoints.
- Retain the deployed `reports.clinical`, `reports.operations`, preparation/review and surveillance role map. Do not introduce the older branch's alternative Reporting officer role or `.read` permission names; that would disconnect existing local report workflows and require an unnecessary production permission change.
- Retain the live DPO governance protections, staff disclosure audit and MFA recovery controls. Add the earlier branch's serializable staff-change transaction so target-role checks, updates, session revocation and audit share one transaction.
- Retain the live staff form's asynchronous reset fix and add the earlier browser onboarding regression test.
- Add the monthly report's minimum-field database projection; names, identifiers, notes and unused triage data are not loaded merely to calculate aggregates.
- Retain the live committed-source evidence collector and restore safeguards, which already supersede the earlier branch's evidence generator and open restore item.
- Retain MFA enforcement, local reporting/IDSR and measured-vitals workflows. Uncommitted UI work in other checkouts is excluded.

The CI evidence-export step now explicitly selects the tested SHA and writes valid JSON without npm banner output. MFA regression tests exercise the protected management API because optional Account security navigation was intentionally hidden in the live baseline; mandatory sign-in and recovery screens remain browser-tested.

No schema migration, role provisioning, password change or user assignment is needed for this consolidation. The database migration head remains `20260924130000_workforce_mfa` (47 migrations). Deployment preserves mandatory MFA and the existing blocked readiness gates. This is a review deployment, not DHA certification or clinical go-live approval.

Production verification and the current DHA gap list will be recorded in a separate dated release record after deployment.
