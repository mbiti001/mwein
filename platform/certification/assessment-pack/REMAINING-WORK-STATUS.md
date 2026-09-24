# Remaining DHA work — current implementation status

22 September 2026. Accountable owner: Edwin Mbiti Chavulimu. **Not yet certification-ready or deployed.** This is the current engineering status; older dated audit evidence remains a baseline.

| Checklist item | Current result | Remaining exit condition |
|---|---|---|
| APP-01–05: DPO, privacy/read controls, reporting permissions, restore safeguards | Implemented in remediation source | Approved rollout and deployed verification |
| APP-06: access-audit inventory | All API route files inventoried against source hashes; additional operational, administrative, clinical scheduling and export reads audited; exceptions explicitly recorded | Independent branch-level/security assessment and operational audit custody/retention evidence |
| APP-07: release-bound evidence | Committed-source collector implemented | Freeze the assessor build and attach approved runtime/operational artifacts |
| APP-08/09: reporting and IDSR | Local reports with independent review/frozen revisions; local case/event register with recorded manual notifications | County-approved dictionaries, case definitions, forms/calendar/routing, surveillance responsibility, weekly-return design, automated escalation and accepted national delivery/acknowledgements |
| APP-10: national exchange | Removed facility code from Patient.identifier in the preparation helper | Accepted profile packages, patient/organization/practitioner identifiers, mappings, authorized sandbox and actual conformance/transport tests. Helper is not connected to a production exchange |
| APP-11: workforce MFA | Google Authenticator-compatible enrollment, one-use recovery, protected factor replacement and separate-administrator recovery implemented | Deployment, individual enrollment, approved identity/recovery procedure and witnessed acceptance; OIDC remains optional and incomplete |
| APP-12: operations | Safe backup/restore and audit tooling available | Actual encrypted backup custody, immutable retention, provider/project regions and key evidence, monitoring, witnessed recovery and downtime drill |
| APP-13: declared scope | Draft scope and evidence gates retained | Applicant-specific DHA criteria and accountable decisions on AI/integration applicability; no gates waived by code |
| APP-14: acceptance | Synthetic technical checks and browser coverage expanded | Qualified clinical/finance UAT, agreed capacity/accessibility targets, independent penetration assessment and closed findings |
| Reception workflow | Visit vitals capture and explicit nursing review implemented | Production migration/permission provisioning and staff walkthrough |

## Completed in this implementation round

- Resumed MFA after the user's follow-up instruction; see [MFA implementation and operating requirements](../WORKFORCE-MFA-IMPLEMENTATION.md).
- Added fail-closed read auditing for queues, recall lists, specialty records/metrics, staff access, administrative evidence/configuration, data-quality work, billing shifts, inventory/supply, import previews and terminology results. The digest records attribution without copying returned data into the log.
- Shared recall lists expose scheduling details without clinical referral reasons/risk ratings. Administration overview excludes session token hashes.
- Audit export uses a consistent database snapshot and records the exported digest after collection; the export's own access event is available in subsequent exports. No claim of off-provider immutable storage is made.
- The route inventory pins exceptions and reviews to exact file hashes. New/changed routes and unreviewed aliases fail enforcement; static call detection is not proof of every branch's correctness.
- Removed the known facility-as-patient-identifier defect. [FHIR R4 defines Patient.identifier as an identifier for the patient](https://hl7.org/fhir/R4/patient-definitions.html#Patient.identifier). Profile/registry acceptance remains pending; no substitute national identifier was invented.

## Work that needs external evidence or decisions

Edwin must arrange or supply the actual portal-generated checklist/classification, privacy and clinical approvals, verified hosting/key/backup records, qualified testers, and county/HIE interface requirements/access. Charles remains the data-protection contact under Edwin's accountability. User-provided Busia County, Nambale Subcounty and MFL 31749 remain the reporting context; no registry verification is implied.

No signed approval, identity check, recovery drill, provider contract, national acknowledgement or fee waiver has been fabricated. Production rollout is still a release task: approved backup/key custody, all pending migrations and scoped permissions, staff onboarding and post-release smoke tests are required before claiming deployed readiness.

## Verification record

[Retained synthetic evidence](technical-evidence-mfa-audit/README.md): 356 unit tests, 47 migration checks and all 43 distinct browser scenarios have passing results across the regression suite and targeted MFA rerun. The production-mode fixture additionally exercises mandatory enforcement. No production changes were made.
