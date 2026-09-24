# Privacy decisions and evidence schedules

25 September 2026. Companion to the [DPIA](PRIVACY-DPIA-AND-PROCEDURES-DRAFT.md). All proposed policy choices require accountable review. Protected locations and contacts are not yet supplied. Owner selected SSD backup and identified Charles as custodian, with storage away from the computer. Encryption and separate-site storage are not confirmed. Owner directs retention to follow applicable MOH guidance and all other handling to follow Kenyan law. This is the adopted policy direction; class-specific legal mapping and operating evidence remain required.

## Kenyan retention authority and source check

Policy direction adopted from owner on 25 September 2026: apply relevant Ministry of Health guidance and Kenyan law, with record-specific requirements, legal holds and documented disposal. The DPO/records lead must cite the actual MOH instrument/version/clause for each clinical class and check its applicability to this private outpatient service.

The [ODPC health-data guidance, section 4.5](https://www.odpc.go.ke/wp-content/uploads/2024/02/ODPC-Guidance-Note-on-Processing-of-Health-Data.pdf) requires justified retention and explains that the Data Protection Act does not set a single specific retention duration. Its seven-year patient-file scenario is an example, not a universal MOH rule. Do not convert it into automatic deletion for every patient or record type.

Sources checked: the [MOH guidelines portal](https://www.health.go.ke/guidelines-standards-and-policies-portal), [ODPC laws catalogue](https://www.odpc.go.ke/data-protection-laws-kenya/) and official ODPC health-data guidance. A current, applicable MOH record-class retention schedule was not retrieved in this review; the MOH portal could not be fetched. Draft regulations and non-official summaries are not treated as binding periods. Charles/records lead should obtain the applicable schedule from the Ministry/county health-records authority and retain its version. This is a specific evidence gap, not a request to invent policy.

Until the class mapping is approved, no automatic retention deletion is configured by this task. Apply existing lawful holds and controlled access; review necessity rather than assuming permanent retention. Once authority is established, record the trigger, duration, exceptions, review cadence and disposal evidence per class, including backups and logs.

## Record-class retention approval sheet

For every row, DPO and the responsible lead must enter the actual period, legal/policy authority, start trigger, hold rules, disposal approver, implementation method, verification evidence and next review date. Blank/pending is not permission for indefinite retention or immediate deletion. No numeric retention period is invented here.

| Record class | Proposed trigger to review | Storage/copy scope | Period / authority / approver |
|---|---|---|---|
| Identity and clinical care, results, medicines/referrals | Relevant last-care/closure event; child-specific rules to assess | Database, authorized exports, clinical paper | Pending clinical + DPO |
| Finance, payer and reconciliation | Relevant financial-period close | Database, receipts, finance exports | Pending finance + DPO |
| Consent, rights and disclosure decisions | Request/consent closure or superseding decision | Database, delivery evidence and working copies | Pending DPO |
| Staff, access and MFA/session material | Employment/role/account/session lifecycle | Database and identity provider where used | Pending identity + DPO; promptly revoke access independently of record retention |
| Audit and privileged operations evidence | Event/verification date | Database plus immutable export store | Pending compliance + DPO |
| Backups including SSD copies | Verified backup creation and superseding recovery points | Named encrypted media/provider copies | Pending operations + DPO; align with approved recovery objectives |
| Logs, support artifacts and local downloads | Collection or resolved support/export purpose | Provider logs, devices and approved support store | Pending operations + DPO |

Hold register fields: record scope, authority, reason, owner, start, review date, access restriction and release approval. Disposal record fields: schedule version, affected copy classes, hold check, authority, operator, method, timestamp, verifier and exceptions. SSD sanitization/retirement must follow the media's supported secure-erasure method with verification; deleting a file is not evidence of sanitization.

## Provider and transfer assessment

| Service / observed purpose | Known fact | Project-specific evidence and decision still required |
|---|---|---|
| Vercel / application processing | Public deployment; prior inspection showed function region iad1 | Account/legal entity, all processing/log/support regions, DPA/version, subprocessors, administrative MFA/access export, encryption/key responsibility and log retention |
| Neon / database and provider recovery | PostgreSQL, production health connected at expected migration | Project/branch region, TLS mode/certificate validation, encryption/key ownership, database roles, retention/exit/export terms, backup configuration and access review |
| WHO ICD / terminology | Source sends entered term/code through server integration | Recipient role/terms, query retention/logging/locations and lawful transfer assessment; staff term-only procedure |
| SSD / owner-selected backup medium | SSD chosen by owner on 25 September | Charles is custodian; away from computer per owner. Confirm availability/asset identity, private location, encryption, keys, disconnected storage, separate-site copy, replacement and verified restore |
| Immutable audit destination | Not supplied | Provider/custodian, enforced immutability policy, duration, access, verification receipts and exit process |
| AI / potential future processing | Helper present; source search found no application caller | Explicit scope decision; provider/project terms, actual payload, retention/residency and clinical review before activation |
| National reporting/exchange | Local reporting/manual records; no production delivery claimed | Authorized recipients, dataset/profile, authority, transport, acknowledgement and agreement before transmission |

For each external processing location, the DPO must document whether cross-border transfer occurs, applicable basis/safeguard, necessity, recipient access, onward transfers, remedies and contract evidence. Function region alone does not describe all provider processing. Marketing statements or an environment-variable value do not establish project compliance.

## Patient notice — wording for review, not publication

MWEIN MEDICAL SERVICES uses information about you to identify you, document and coordinate your care, manage related payments, protect our systems and handle your privacy requests. Approved public-health disclosures and their legal grounds must be specified before this notice is issued. Information may include your identity and contact details, clinical history, results, medicines and relevant payment records.

Authorized staff access information according to their work. Our application uses Vercel and Neon; the approved processing locations, safeguards and other recipients must be added after provider review. Staff use WHO terminology searches and must enter diagnostic terms only. Our approved retention periods and any legal-hold exceptions must be inserted here. This draft does not announce an AI service or national integration as active.

To ask about your information, request access/correction or raise a privacy concern, use [approved patient/DPO channel — pending]. Explain representative/child arrangements, applicable rights and limitations, response expectations and the ODPC complaint route in the approved local-language/accessibility formats. Add the approved lawful bases, controller address, DPO contact, notice version and effective date. Do not publish this draft with placeholders.

## Decision handoff

Edwin: confirm patient/DPO channel, evidence-store custodian, required reviewers and dates. Charles/DPO: approve processing bases, notice, retention and provider/transfer analysis. Clinical lead: approve children/representative treatment and minimum data. Operations: supply the concrete records in [the recovery workbook](INFRASTRUCTURE-AND-RECOVERY-WORKBOOK.md). Each decision needs the artifact/version, named reviewer, date, outcome and conditions; do not substitute a generic 'approved' checkbox.
