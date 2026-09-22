# Privacy assessment and operating procedures — review draft

Accountable owner: Edwin Mbiti Chavulimu. Data-protection contact/reviewer: Charles Karani, per the earlier user nomination. Controller name on the supplied ODPC certificate: MWEIN MEDICAL SERVICES; the supplied business search matches that name and lists Edwin as proprietor. Specialist acceptance and final privacy approval remain pending. This document supplies application-specific analysis for DPO review, not an approved DPIA or legal conclusion.

The [ODPC DPIA guidance](https://www.odpc.go.ke/wp-content/uploads/2024/02/ODPC-Guidance-Note-on-Data-Protection-Impact-Assessment-1.pdf) describes assessment of processing, necessity/proportionality and risks to individuals. Consult the [official guidance catalogue](https://www.odpc.go.ke/guidelines-2/) for health data, consent, transfers and policy guidance. The following analysis is based on Mwein's reviewed implementation; the DPO must validate actual operations and required legal steps.

## Processing and necessity assessment

| Processing | Purpose and minimum data | Necessity/minimization decision to review |
|---|---|---|
| Registration and identity | Distinguish the patient and link care; identity/demographics/contact | Validate mandatory fields; avoid collecting extra identity documents without purpose |
| Clinical care | History, measurements, diagnoses, results, prescriptions and outcomes | Restrict role/facility access; explain sensitive-note handling and special-category access |
| Finance | Charges, payments, receipts and payer information | Limit finance access to necessary information; review billing permission's access to monthly diagnosis summaries |
| Rights/consent | Request, identity-check outcome, consent and delivery evidence | Prefer verification outcome/reference over unnecessary copies of identity documents |
| Audit/security | Actor, action, target, timing and integrity records | Review coverage and metadata for unintended clinical content; restrict administrative access |
| Terminology | Diagnostic query sent to WHO | Terms/codes only; prohibit pasted identifiers/notes; assess notice and query handling |
| Backups and exports | Recover records or deliver authorized records | Protected destinations, restricted keys, defined expiry/disposal and restore access |

Record the lawful processing basis for each purpose, applicable health-data condition, information provided to patients, and any consent/withdrawal or statutory limitations. These decisions remain unresolved; a consent screen alone does not settle the legal basis for every activity. Assess children, representatives and vulnerable patients explicitly.

## Risk register — preliminary, not scored by an accountable assessor

| Risk | Existing technical evidence | Required mitigation/evidence | Residual decision |
|---|---|---|---|
| Wrong-patient linkage or harmful correction | Identity history/reversal and duplicate review workflows | Clinician/registration UAT, correction authority and reconciliation procedure | Pending clinical/DPO review |
| Unauthorized staff or compromised account | Facility/role checks, session controls | Identity lifecycle, access review, MFA disposition, independent assessment | Open; MFA paused |
| Sensitive query sent externally | WHO uses entered search text | Training, notice, contractual/transfer review and term-only demonstration | Pending |
| Excessive clinical access through reporting | Monthly summary requires billing.read | Review role purpose, minimum dataset, access-audit and disclosure controls | Open engineering/privacy finding |
| Loss of records or ransomware/provider failure | Recovery branch and backup tooling | Independent encrypted backup, measured restore, key custody | Open |
| Uncontrolled export or stale retained data | Rights workflow and single-use export | Approved delivery, retention/legal hold, download custody and disposal | Open |
| Unproven hosting/transfer safeguards | Vercel/Neon architecture known | Actual regions, processor/subprocessor terms, access and encryption records | Open |
| AI use outside declared scope | AI libraries present; no application call site found in baseline source search | Verify build/routes and assessor boundary; separate assessment before activation | Pending scope decision |

DPO records likelihood, harm severity, affected people, treatment owner/deadline and residual acceptance for each risk after consulting clinical staff, operations and appropriate patient representatives. Record consultation participants, concerns, resulting changes and unresolved objections. Escalate unresolved high risk through the applicable legal/organizational process; do not mark this assessment approved by default.

## Draft rights-request procedure

1. Receive the request through the approved facility channel; record date, request type and a safe reference.
2. Verify requester identity and representation proportionately using the approved method; record the outcome without unnecessary document copies.
3. DPO reviews scope, applicable grounds/exemptions, third-party information and the applicable response deadline. Record the deadline and reason from approved guidance rather than inventing one.
4. Authorized staff prepare/review the response and use the controlled export where applicable. Verify the destination before release; single-use download is not identity verification.
5. Record delivery outcome and any review/complaint route. Apply the approved retention/hold schedule to working copies and evidence.

## Draft retention and legal-hold control

Create a record-class schedule for clinical records, identity history, consent/rights, finance, staff/session records, audit, exports, backups and support logs. For each class record legal/policy authority, trigger, retention period, storage, hold conditions, deletion method and approving owner. All periods are pending approval. Preserve applicable holds; authorize and verify disposal after the hold is released. Do not delete records merely to complete this draft.

## Patient notice content awaiting approval

Explain the verified controller identity and contact; purposes and bases; data categories; authorized recipients/providers; actual hosting/transfers and safeguards; retention principles; rights and how to exercise them; representative/children arrangements; complaint contact; and update date. State that terminology search uses WHO and instruct staff to send diagnostic terms only. DPO contact, legal bases, recipients/regions and retention are not yet confirmed, so this notice is not ready to publish to patients.

## Processor and transfer evidence schedule

For Vercel, Neon, WHO as applicable to the actual relationship, backup/audit custodians and any future AI provider, record legal entity/role, service and region, data categories, contract/version, subprocessors, transfer assessment, access controls, retention/deletion, incident assistance, audit rights and return/exit provisions. A provider marketing page cannot establish the project's configured controls. Attach executed terms or an accountable contract review; none is invented here.
