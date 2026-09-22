# DHA app audit and implementation backlog

22 September 2026 • Accountable owner: Edwin Mbiti Chavulimu • Status: not certification-ready

## Implementation update

Items 1–4 have now been implemented on `codex/dha-control-remediation`; see [control remediation record](../DHA-CONTROL-REMEDIATION.md). APP-01 through APP-05 are addressed in source; APP-06 has improved inventory and regression coverage with remaining routes explicitly unclassified. The original audit below remains a baseline record. Production rollout, real recovery evidence and external certification approvals remain outstanding. APP-07 is now implemented in source: committed-blob evidence collection, artifact hashes, explicit release selection and dirty-checkout regression tests. See the [evidence collection instructions](../README.md). No production verification is implied.

## Audit boundary and result

Reviewed deployed source `a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7` and documentation HEAD `d468e27`. Application findings refer to that baseline, excluding unpublished MFA work. This is an engineering gap review, not penetration testing, clinical acceptance or a DHA score. The latest retained public probe reports the baseline healthy and readiness blocked. No new production mutation or deployment is part of this audit.

The [official DHA portal](https://certification.dha.go.ke/) lists ODPC registration, completed DPIA and evidence of encryption at rest/in transit as submission prerequisites. It generates further evidence/testing requirements from application claims. The current individual/innovator application checklist and fee waiver are not verified; the last portal observation was email verification. Registration does not establish exemption from technical requirements or both fees.

**Assessment:** the outpatient care path is implemented and has strong synthetic engineering coverage. The remaining work includes confirmed application defects, incomplete national/reporting capabilities, production controls and external approvals. These are different kinds of work and cannot be closed by committing documents alone.

## What is already supported

Registration/check-in, measured triage, signed consultations/addenda, diagnostics, prescribing/dispensing, invoices/cashier shifts, explicit clinical closure, referral/follow-up workflows, identity correction history, consent/rights handling and clinician shortage cover have implementation evidence. WHO ICD-11 live authentication/search has been verified independently of national exchange. The earlier same-day isolated baseline run passed 239 unit tests, 28 browser scenarios, type checking and 43 migration checks, with retained outputs in technical-evidence-20260922. No unchanged test suite was rerun merely for this documentation commit.

Ownership, CR13/business-search evidence, ODPC certificate, Edwin's PIN and tax-compliance documents are now indexed. The TCC states validity through 12 November 2026; live KRA status remains unverified. Manual, SRS, architecture, DPIA draft and UAT protocol are available; drafted does not mean approved.

## Confirmed application findings

Priorities below are engineering implementation priorities, not official DHA grades. P1: control gap to close before asserting readiness. P2: assurance/reproducibility improvement.

| ID | Priority / state | Finding and source at baseline | Outcome required |
|---|---|---|---|
| APP-01 | P1 / ready to implement | `src/app/api/admin/users/route.ts:12` omits DATA_PROTECTION_OFFICER from accepted/listed roles; `src/lib/staff-access.ts:1` omits it from governance-role protections | Safe DPO onboarding and management through UI/API with correct governance authorization |
| APP-02 | P1 / ready to implement | Sensitive GET handlers for appointments, dispensing details, patient problems and referrals return records without a read-audit append; both reporting GETs lack access-audit events | Complete attributable disclosure audit, preserving facility/session boundaries and failing closed when required audit persistence fails |
| APP-03 | P1 / ready to implement | Monthly and operations reports use `billing.read`; clinical summaries become available to every role with this permission, including shortage cover | Separate clinical-report access from invoice/payment access; explicit reporting role matrix and minimum response data |
| APP-04 | P1 / ready to implement | Candidate GET responses above and patient privacy GET do not explicitly set private/no-store; proxy adds CSP but no global no-store policy | Explicit no-store policy for sensitive success/error responses; verify actual headers rather than assume a proven cache leak |
| APP-05 | P1 / ready to implement | `scripts/restore-drill.mjs:9` compares raw URL strings only, then invokes destructive pg_restore; source URL can be absent | Refuse a production-equivalent or unverified restore target before invoking pg_restore; require verified disposable-target identity |
| APP-06 | P2 / ready to implement | `scripts/audit-coverage.mjs` checks specific function-name strings in six path families, not all access paths/callees | Reviewed route/control inventory plus behavioral tests; avoid counting existing audited paths as gaps |
| APP-07 | P2 / ready to implement | `scripts/certification-evidence.mjs` labels HEAD but inventories migrations from the working tree | Bind evidence to committed source/schema/migrations, reject or explicitly distinguish dirty trees; exclude draft MFA correctly |
| APP-08 | P1 / dependent | Monthly source summary has no evidenced immutable reporting submission/revision/acknowledgement lifecycle | Approved dataset mapping, review/approval, correction and delivery lifecycle |
| APP-09 | P1 / dependent | No completed IDSR/notifiable-event workflow established | Versioned case definitions, alert routing, escalation, review and genuine acknowledgement |
| APP-10 | P1 / dependent | Kenya Patient helper checks URL shape and places facility code among patient identifiers; no application converter call site found; admin exchange returns 503 | Accepted profile mapping, registries, validation, authorized transport, retries/idempotency and acknowledgement handling |
| APP-11 | P1 / paused | Workforce OIDC acceptance is incomplete and native MFA is unpublished user-paused work | Keep paused; decide identity approach and required assurance before any resumed implementation |
| APP-12 | P1 / operations-dependent | Backup/audit export tooling exists, but encryption/custody/retention/monitoring evidence is incomplete | Approved encrypted backup custody, immutable audit retention, monitored execution and measured recovery |
| APP-13 | P2 / scope-dependent | AI libraries and unconditional AI/internal-integration readiness gates exist despite proposed scope exclusions | Formal applicability model or documented release scope; do not remove mandatory controls just to turn readiness green |
| APP-14 | P1 / validation-dependent | Synthetic tests do not demonstrate clinical safety approval, production capacity, accessibility or independent security assessment | Execute agreed clinical/security/performance/accessibility protocols and fix findings |

## Read-audit inventory result and manual disposition

The existing scanner ran against the isolated committed baseline: **25 selected routes, 9 candidate gaps**. It is a limited lexical inventory, not a complete count of unaudited endpoints. Output is retained in [audit-coverage-baseline.json](audit-coverage-baseline.json).

| Candidate | Manual disposition |
|---|---|
| appointments GET | Confirmed missing read-audit event in handler |
| orders/[id]/dispense GET | Confirmed missing read-audit event in handler |
| patients/[id]/problems GET | Confirmed missing read-audit event in handler |
| referrals GET | Confirmed missing read-audit event in handler |
| reports/moh-monthly GET | Confirmed no report-access audit; classify aggregate disclosure and minimum data explicitly |
| reports/operations GET | Confirmed no report-access audit; classify operational/financial disclosure explicitly |
| patients/[id]/identity-reconciliation GET | False positive: PATIENT_IDENTITY_HISTORY_VIEWED appended before return; private/no-store already set |
| patients/[id]/privacy GET | False positive for audit: PATIENT_PRIVACY_RECORD_ACCESSED appended in transaction; explicit no-store still missing |
| visits/[id]/discharge POST | False positive: closeClinicalVisit appends VISIT_CLINICALLY_CLOSED in the caller's transaction |

Do not claim all nine are missing audit events. The scanner also omits path families such as visit summaries and admin/privacy exports, so the full route inventory must be reviewed before claiming complete coverage.

## Implementation-ready work packages and acceptance criteria

All packages below are ready to code from the reviewed baseline. They are not represented as implemented by this commit. Read platform/AGENTS.md and the installed Next.js documentation before coding. Use a clean checkout/worktree so unrelated paused MFA changes cannot enter a patch.

### Package A — DPO access (APP-01)

Files: admin/users route; staff-access helper/tests; StaffWorkstation role navigation; bootstrap/role provisioning verification. Add DPO to the assignable list and governance-role classification together. Check who can grant/manage governance roles and prevent lower-privileged administrators from disabling/resetting existing DPOs through the same omission. Provision the role definition without changing passwords or automatically assigning Charles/Edwin.

Acceptance: authorized administrator can create/assign the role; unauthorized administrator cannot assign, disable, reset or change a governance-protected DPO; wrong-facility targets are denied; role changes revoke sessions and append attributable audit; DPO can reach the intended privacy workflow. Include positive and negative API tests plus a synthetic UI path. No live user assignment is implied by documentation ownership.

### Package B — read audit and sensitive responses (APP-02, APP-04, APP-06)

Files: identified route handlers; audit-access helper/tests; audit coverage script; explicit endpoint inventory. Reuse existing audit fingerprinting to avoid copying identifiers, names, search terms or clinical notes into audit metadata. Record actor/session/facility, action and bounded result attribution before disclosure. Treat aggregate reports as report access with defined attribution. Preserve role/tenant filtering and return explicit private/no-store on sensitive success/error responses.

Acceptance: every reviewed disclosure appends the expected event; failed audit persistence prevents disclosure; denied/cross-facility requests expose no records; no PHI enters audit fingerprints; response headers are correct; existing privacy/identity/discharge audit paths are recognized; an intentionally removed control fails the coverage/behavioral check. Expand inventory beyond the script's current six route families. Do not suppress warnings with blanket exceptions.

### Package C — reporting authorization (APP-03)

Files: monthly/operations routes, reporting navigation, permission definitions and scoped provisioning. Define clinical-report access separately from billing.read. Keep the cover clinician's intended invoice/payment abilities without granting facility-wide clinical aggregates. Split operational finance and clinical responses where necessary. Edwin approves the proposed role matrix before production permission assignment; code and tests can be prepared now.

Acceptance: billing-only and cover users are denied clinical aggregates; approved report roles see only their facility; UI matches server checks; existing billing remains functional; report access is audited; no automatic role escalation during provisioning. Coordinate with Package B to avoid duplicate audit events.

### Package D — restore safety (APP-05)

Files: restore-drill script, focused command-construction/guard tests and operations manual. Require source identity and explicit verified disposable target. Normalize host/database/port/URL encoding and known direct/pooler aliases, but do not rely on normalization alone as proof of distinct resources. Use provider/DB identity or an independently established disposable-target allowlist/marker and fail closed on ambiguity. Verify backup checksum and controlled target before --clean; avoid credentials in output.

Acceptance: absent source, equivalent URLs, reordered query parameters, pooler/direct aliases to the same database and unverified targets are rejected before process spawn; an explicitly verified distinct synthetic target restores successfully; checksum failure stops execution. Production restore is not part of implementation testing.

### Package E — reproducible evidence generation (APP-07)

Implemented on `codex/dha-control-remediation`. Validation: 288 unit tests passed across 67 files, including seven collector regressions. Collection against application commit `a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7` produced 43 migrations and 47 independently checked artifact hashes from both the remediation checkout and the original dirty checkout; all 25 paused-draft file hashes remained unchanged. No runtime probe or deployment was performed for this change. The original scope and acceptance criteria below are retained. The collector produces source-only evidence; operational and certification claims require separate evidence.

Files: certification-evidence script/tests and release documentation. Read selected commit tree for migration inventory/schema hashes, record source SHA and collection time, and distinguish runtime observations and document commit from application release. Reject unsupported dirty-source generation or clearly mark it non-release evidence.

Acceptance: the paused MFA migration cannot be counted under the deployed SHA; clean release produces exactly the expected 43 migration entries; changed/untracked schema or migration files cannot produce a misleading clean-release record; generated hashes match committed blobs. Keep secrets out of output.

Reporting/IDSR follow-up: the [APP-08 / APP-09 requirements package](REPORTING-IDSR-REQUIREMENTS.md) now defines workflows, configuration contracts and acceptance tests. Implementation and authoritative input approval remain outstanding.

## Work requiring external inputs or approval

- **Reporting/IDSR (APP-08/09):** approved dataset/version, organization-unit mapping, case definitions, periods, code lists, escalation recipients and acknowledgement contracts. Build versioned reporting records after these inputs are fixed; do not invent disease triggers from ICD text.
- **HIE/SHA (APP-10):** exact accepted profile packages and identifiers, facility/practitioner/client registry authority, sandbox authorization, contracts and genuine conformance/acknowledgement evidence. WHO connectivity is not HIE readiness. Keep transmission disabled until accepted.
- **MFA (APP-11):** user pause remains controlling. No code, dependencies, migration or enrollment from this draft may enter the audit commit.
- **Operations (APP-12):** actual Vercel/Neon/database/backup locations, encryption standards, key/access custody, immutable targets, monitoring and approved recovery objectives. Existing pg_dump tooling does not itself encrypt the dump or upload it off-provider. Run a witnessed disposable-target restore and downtime/incident rehearsal.
- **Scope/readiness (APP-13):** applicant-specific checklist, declared AI scope and criteria applicability. Distinguish internal readiness gates from DHA scoring; never treat an environment variable as an approval.
- **Acceptance (APP-14):** qualified clinical UAT, medication/ICD approval, tested service targets, accessibility, independent penetration assessment and closed findings. Edwin owns arranging evidence; ownership does not fabricate reviewer qualifications.

## Submission and release exit criteria

Before self-attestation: verify applicant-specific documents and fee treatment; complete/approve DPIA; establish applicable ODPC coverage and encryption/key evidence. Before assessor testing: resolve application control findings; approve scope, manual and SRS; freeze a synthetic assessor URL/version; issue protected least-privilege accounts; map test cases and authorize security testing. Before declaring readiness: retain clinical/security/restore/reporting/exchange results and close mandatory gaps. National integration exclusions cannot waive required criteria for the chosen category.

Recommended implementation order: A → B/C → D → E, with external evidence collection in parallel through Edwin. Then implement dependent reporting/exchange packages against approved contracts, perform independent acceptance and freeze the assessor release. No unsupported certification percentage is assigned.
