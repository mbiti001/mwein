# Proposed certification scope and decisions

Status: proposed, not approved. Baseline and reference rules are in [the index](README.md).

Proposed product classification: facility outpatient HMIS/EMR. The applicant must confirm the actual DHA classification; this wording is not an official portal classification selection. Intended users are trained facility staff working under assigned roles. The application supports documentation and workflow; clinical decisions remain with qualified staff.

## Capability boundary

| Capability | Proposed claim | Conditions and limits |
|---|---|---|
| Registration and identity | Include local patient registration, duplicate review and correction history | No national identity verification; no automatic duplicate merge |
| Outpatient workflow | Include check-in, measured vitals, consultation, orders, explicit clinical closure and follow-up | No unattended cancellation or inference that payment equals discharge |
| Diagnostics | Include local laboratory and imaging workflows | Clinician/laboratory UAT and result-verification evidence required; no instrument integration claim |
| Medicines and inventory | Include prescribing, local dispensing and inventory controls | Medication-rule and catalog approvals required; no comprehensive formulary safety certification claim |
| Billing | Include local invoices, receipts and cashier shifts | Exclude live SHA claim submission/settlement; require independent finance reconciliation |
| Clinician shortage cover | Include explicit administrator-assigned cover role | Manual removal when shortage ends; no automatic expiry or finance approval powers |
| WHO terminology | Include server-side WHO ICD-11 MMS search and recorded selection | Release 2026-01; coding approval and normal clinician walkthrough pending |
| Privacy and audit | Include available consent/rights, identity correction and audit workflows | Not a declaration of legal compliance; retention, external custody and full access-audit review pending |
| Reports | Include local operational summaries | Do not claim KHIS/IDSR submission, complete notifiable-event workflow or acknowledged delivery |
| National exchange | Exclude production transmission from proposed claim | Preparation code exists; authority/profile/conformance approval remains outstanding |
| AI-generated summaries | Exclude from proposed claim pending explicit decision | AI libraries and governance definitions exist in source; do not assume a gate definition proves live enforcement or disabled functionality |
| Native workforce MFA | Deployed and required in current release | Individual enrollment and approved operational evidence remain pending |
| Other care settings | Exclude unassessed inpatient, theatre, emergency, offline synchronization and device integration | Presence of specialty screens does not establish validated scope |

An exclusion is a claim boundary, not a waiver of a mandatory DHA criterion. If DHA requires an excluded capability for this classification, amend the scope and implementation plan before applying. The current internal readiness engine still has 13 gates, including AI, MFA and national integrations; this draft changes none of them.

## Decisions requiring accountable review

| ID | Decision proposed | Accountable role | Required record |
|---|---|---|---|
| DEC-01 | Adopt outpatient core scope above | Facility leadership + medical director | Signed module list, intended use and exclusions |
| DEC-02 | Exclude AI from this assessment | DPO + medical director + engineering owner | Approved disposition; assessor-environment route/UI/configuration review proving the boundary, or an AI validation and processing pack if included |
| DEC-03 | Approve MFA onboarding, recovery and emergency-access operating procedure | Identity owner + facility leadership | Implementation resumed; witnessed recovery, key custody and rollout evidence remain required |
| DEC-04 | Select DHA classification and mandatory reporting/exchange coverage | Compliance + interoperability owners | Portal/framework mapping with no unsupported non-applicability claims |
| DEC-05 | Freeze synthetic assessor environment at an approved version | Release + operations owners | URL, release/migration pair, synthetic accounts, reset procedure and test authorization |

## Owner register

**Edwin Mbiti Chavulimu is the accountable owner for all workstreams**, per the user’s latest instruction on 22 September 2026. The supplied official search identifies him as proprietor of MWEIN MEDICAL SERVICES, business name BN-VDCAPY53. Charles Karani remains the previously designated data-protection contact under Edwin’s accountability. Specialist reviewer qualifications, deputies, protected contact details and target dates remain pending; accountability does not establish clinical credentials or completed approval. See [leadership record](LEADERSHIP-AND-APPOINTMENT-RECORD.md) and [registration evidence](BUSINESS-REGISTRATION-EVIDENCE.md).

In the table below, roles describe the required work/review disciplines; Edwin is accountable for every row.

| Owner role | Deliverables | Approver |
|---|---|---|
| Facility leadership | Corporate documents, scope, staffing/downtime ownership | Authorized organizational signatory |
| Medical director | UAT, clinical closure, medication rules, ICD governance, AI disposition | Facility clinical governance authority |
| Data protection officer | DPIA, notices, rights procedure, processor terms and transfer review | Organizational data controller |
| Identity/security owner | Joiner/mover/leaver, MFA disposition, emergency access, penetration test closure | Facility leadership |
| Operations owner | Hosting location, encryption, key/access evidence, backup/restore, monitoring | Service owner |
| Compliance owner | Framework mapping, evidence custody, audit retention, application | Authorized signatory |
| Finance owner | Cashier reconciliation and separation of duties | Facility finance authority |
| Health records officer | Reporting definitions, corrections and public-health workflow | Medical director |
| Interoperability owner | National profiles, sandbox credentials, conformance and acknowledgements | Authorized integration authority |
| Release/engineering owner | Frozen build, manifest, test artifacts and defect closure | Release approver |
