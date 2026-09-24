# Governance access and certification evidence — 25 September 2026

Status: locally implemented and tested; not deployed, clinically accepted or DHA certified. Builds on outpatient disclosure commit `9f08cc0`. Paused MFA changes in the original workspace are excluded.

## Delivered

- **APP-01 — DPO access:** DATA_PROTECTION_OFFICER is available through the staff UI/API and protected as a governance role. HR/user administrators without governance authority cannot create, assign, disable, reset or demote DPO accounts. Staff target checks and updates share a serializable transaction. Changes revoke existing sessions and record actor, facility and session. The staff form retains its form element across the asynchronous create call so successful creation clears the form correctly.
- **APP-02/04 — reporting and privacy disclosures:** both report handlers persist a REPORT_ACCESSED event before returning data, using a fingerprint of the generated response rather than copying its clinical or financial content into audit metadata. Audit failures prevent disclosure. Both reports and privacy GET success/error responses use private/no-store. The existing privacy access event now explicitly includes facility attribution. These additions do not claim all application endpoints are reviewed.
- **APP-03 — explicit reporting authorization:** billing access no longer opens facility-wide reports. Monthly clinical summaries require reports.clinical.read; the mixed clinical/financial operations report requires reports.operations.read. Navigation and report sections follow the same permissions. Monthly reporting queries only the fields needed for its aggregates.
- **APP-07 — source-bound evidence:** certification:evidence inventories and hashes the selected commit's schema and migration SQL. It records the collector commit separately, rejects dirty trees by default, and marks explicitly allowed dirty collections NON_RELEASE_SOURCE_SNAPSHOT. Runtime evidence is explicitly NOT_COLLECTED. Control descriptions are labelled a collector checklist, not validation results for a selected historical source.

## Reporting and privacy role matrix for review

| Role | Patient privacy workflow | Monthly clinical report | Operations report | Invoice/payment permissions |
|---|---|---|---|---|
| Data protection officer | Existing privacy.manage grant | No | No | Unchanged; none by this role |
| Reporting officer (new) | No | Yes | Yes | None by this role |
| Billing | No | No | No | Existing invoice/payment access retained |
| Clinician shortage cover | No | No | No | Existing invoice/payment access retained |
| System administrator alone | No | No | No | No operational access from system role |
| Other existing roles alone | Existing permissions | No new grant | No new grant | Existing permissions retained |

The operations report contains clinical service activity, stock, claim and cashier information. Its dedicated permission authorizes that complete report; it is not a finance-only report. A future finance-only endpoint should have its own minimum-data contract.

Bootstrap defines the new reporting permissions and role but assigns no existing person to it. The new role is governance-protected, as is DPO. Existing users who previously opened reports through billing.read will lose report access on deployment until a governance-authorized reporting appointment is approved and assigned. The current staff UI assigns one role and replaces the prior role; use a dedicated reporting account only for its named individual, and do not replace a clinician's duties casually. This is an explicit proposed access matrix, not evidence of Edwin's approval of a production appointment.

For a reviewed deployment, provision definitions without an admin password using the existing bootstrap workflow, verify the proposed role matrix, then assign the approved named reporting staff through Users & access. No production provisioning, assignment, password change or deployment was performed here. No schema change is required.

## Verification

- 63 unit test files / 275 tests passed.
- TypeScript validation passed.
- Production build passed in the browser-test setup.
- Isolated production-mode outpatient API rehearsal: 102 checks passed, including real staff create/update, denied governance mutations, session revocation, cross-facility report isolation and audit-chain verification.
- Eight relevant browser scenarios passed across focused runs: DPO creation, protected HR controls, reporting navigation, billing/cover restrictions and existing privacy/clinical-cover journeys. The DPO test was rerun successfully after correcting its select and confirmation selectors; the other seven scenarios already passed.
- Historical-source check against `a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7`: exactly 43 committed migrations; committed schema SHA-256 `33002cf6656909db9d4f55a97dae404c0b5b8eb556a22f1517abf044cbfad730`. Collection during development was correctly labelled a non-release snapshot.

To collect a committed source index after freezing source:

```sh
npm run certification:evidence -- --commit <approved-release-sha>
```

For an explicitly labelled development snapshot, add `--allow-dirty`. Neither mode collects deployment observations, clinical signatures, restore results or laboratory conformance evidence.

## Outstanding work

APP-05 restore-target safety remains an engineering blocker; the existing restore script must not be treated as an approved production restore process. APP-06 still needs a complete reviewed endpoint inventory and behavioral coverage beyond the repaired handlers. Reporting submission/IDSR definitions and national HIE integration need approved contracts and mappings. Clinical UAT, DPIA approval, encryption/key custody, independent penetration testing, backup/restore evidence and a frozen assessor environment remain outstanding. The existing release gates remain active.
