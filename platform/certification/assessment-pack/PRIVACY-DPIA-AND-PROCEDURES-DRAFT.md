# Mwein HMIS data protection impact assessment — review draft

Version 2, 25 September 2026. Status: prepared for review; not signed, approved or submitted. Accountable controller representative: Edwin Mbiti Chavulimu. Designated data-protection contact: Charles Karani; appointment, protected contact details and reviewer acceptance remain to be recorded. Evidence baseline: deployed source `1d1e5eac30296dfbeb1684361379eeff2a252c1c`, migration `20260924130000_workforce_mfa` (47 migrations). See [release evidence](../DEPLOYMENT-20260925.md).

## Decision sought and screening

Review the necessity, safeguards and residual risks of outpatient identity, care, finance, reporting and workforce processing before certification attestation. The system processes longitudinal health records and information concerning children or other vulnerable patients, with cloud hosting and privileged access. Those characteristics warrant a full assessment. This document does not retrospectively establish that any required pre-processing assessment, filing or consultation occurred. The DPO must determine applicable legal steps and document the outcome before signing.

MWEIN MEDICAL SERVICES holds supplied controller and processor registration certificates, visually reviewed with validity and checksums in [ODPC evidence](../DHA-READINESS-20260925.md). Both roles are registered; the role for each real customer/facility relationship must still be established. For own-facility care, the proposed role is controller. For hosting or operating on another facility's instructions, determine that facility's controller role, Mwein's processor obligations and an executed processing agreement. Registration alone does not settle those relationships or certify the application.

Reference checked 25 September 2026: [ODPC DPIA guidance](https://www.odpc.go.ke/wp-content/uploads/2024/02/ODPC-Guidance-Note-on-Data-Protection-Impact-Assessment-1.pdf) and [official guidance catalogue](https://www.odpc.go.ke/guidelines-2/). These support structured assessment and accountable review; the application-specific analysis below comes from the source and evidence pack. Applicable statutory bases and deadlines require the DPO's recorded legal review.

## Processing description and boundaries

Trained facility staff enter records through authenticated browser workstations. The Next.js application on Vercel enforces role/facility access and stores records in Neon PostgreSQL. Audit records share the database boundary. Authorized exports leave that boundary and require separate custody. WHO receives entered terminology search text. No production national transmission is claimed. Source search finds an AI generation helper but no caller of `generateAstraVisitSummary` in `platform/src`; this bounded observation does not prove provider-account configuration, all historical processing or permanent exclusion. AI activation requires a revised assessment and clinical approval.

Affected people: patients, children, guardians/representatives, next of kin, staff and referral/provider contacts. Actual patient/staff counts, annual growth, participating facilities, collection locations, languages and accessibility needs: not supplied; Edwin and the records lead must complete them before approval. Busia/Nambale/MFL 31749 are owner-provided context, not independently verified registry mappings.

| ID / operation | Data and purpose | Necessity / alternative considered | Basis and condition decision required |
|---|---|---|---|
| P01 Registration | Name, local patient number, demographic/age data, identifiers, contacts/address and relationships; link the correct person to care | Local identifier plus proportionate identity checks; avoid extra document copies and compulsory optional contacts | DPO: identify legal basis, health-data condition and representative/child authority |
| P02 Care | Complaints/history, allergies, problems, measurements, diagnoses, orders/results, medicines, referrals and signed plans | Necessary longitudinal record; role-specific access and minimum display. Paper alone adds reconciliation and continuity risks | DPO/clinical lead: establish treatment basis, confidentiality obligations and any special restrictions |
| P03 Finance | Invoice lines, payment/reference, receipts, payer and cashier attribution | Need reconciliation; separate clinical reporting from billing access; avoid unrelated clinical narrative | Finance/DPO: treatment billing, accounting and payer disclosure bases separately |
| P04 Public health/reporting | Aggregates and local case/event records; manual notification history | Prefer approved aggregates where sufficient; case-level identifiers only where required by an authorized reporting purpose | Records/DPO: authority, dataset, recipient and disclosure basis before actual transmission |
| P05 Rights/consent | Request type, identity-check outcome, representation, consent history and delivery reference | Store the verification outcome rather than unnecessary identity copies; restricted export and review | DPO: rights-handling basis, limitations, response deadlines and consent withdrawal consequences |
| P06 Workforce/audit | Staff identity/role, credential verifiers, MFA material, sessions, actor/action/resource references and timestamps | Accountability and protection; restrict administrators and minimize logs | DPO/identity owner: workforce/security basis, notice and retention |
| P07 External terminology | Staff-entered diagnosis terms/codes and server authentication | Use terms/codes only; local coding alternative where available; no patient notes in search | DPO: service role, query handling, transfer safeguards and staff instruction |
| P08 Recovery/support/export | Potentially full database in backups; sensitive audit exports; necessary diagnostic metadata | Recovery needs protected copy; redact support evidence and restrict full exports | DPO/operations: backup/support purpose, recipient roles, location, retention and destruction |

Clinical necessity does not establish the basis for optional secondary use. No research, marketing or unrelated reuse is approved by this draft. Before each new use, document purpose compatibility, recipients, minimum fields and the required authority/notice or consent. All basis decisions above remain pending; record actual statutory provisions and rationale, not a generic 'consent' label.

## Necessity, proportionality and rights safeguards

Record the minimum mandatory fields with registration and clinical reviewers; demonstrate care for patients without optional identifiers or contact details. Test wrong-patient correction without silently rewriting signed history. Distinguish nurse triage from reception measurements. Review restricted notes and disclosure channels with qualified staff. Do not infer that access permission establishes an appropriate care relationship.

Staff must verify patient and recipient before viewing/exporting, lock shared workstations, use individual accounts and report misdirected output. Role/facility checks, MFA, session revocation, audited disclosure and private/no-store responses exist in the release; human practice, device controls and provider administration need separate evidence. Monthly clinical reporting uses `reports.clinical`, operations reporting uses `reports.operations`, and monthly queries select required fields. Browser-cache headers do not prevent screenshots or retained downloads.

Children/representatives: document authority, age/representation checks, confidential-care exceptions and safeguarding escalation with the clinical lead and DPO. Do not grant a representative access merely because a relationship is recorded. Rights requests require proportionate identity verification, scope review, third-party redaction, an approved deadline, reviewer decision and secure delivery. Refusals/restrictions need a recorded basis and complaint route. Log the delivery outcome; single-use download is not identity verification.

## Preliminary risk register

Proposed scoring method for reviewer adoption: likelihood 1 unlikely, 2 possible, 3 likely; impact 1 limited/reversible, 2 significant distress/disruption, 3 severe confidentiality or care harm. Product 1–2 low, 3–4 medium, 6–9 high. Scores below are conservative engineering proposals before operational evidence, not measured probabilities or accepted residual ratings. DPO/clinical reviewers must validate affected groups, rationale and residual score. No risk is accepted here.

| ID | Scenario and harm | Proposed L×I / rationale | Existing control | Required treatment / reviewer | Residual decision |
|---|---|---|---|---|---|
| R01 | Wrong patient or altered history causes unsafe care | 2×3=6; identity error remains plausible | Duplicate review, identity history, signed-record workflow | Synthetic identity/correction UAT, staff procedure and clinical sign-off / clinical lead | Unassessed |
| R02 | Compromised/shared account discloses health data | 2×3=6; workforce practice unverified | Mandatory MFA, role/facility checks, session revocation | Individual enrollment, leaver/recovery rehearsal, access review and penetration test / identity owner | Unassessed |
| R03 | Reports/exports expose unnecessary clinical details | 2×3=6; downstream custody unverified | Separate reporting permissions, reduced monthly projection, audited reads | Role-purpose review, recipient verification, redaction and export custody tests / DPO | Unassessed |
| R04 | WHO query carries identifiers or clinical narrative | 2×3=6; free text can contain sensitive data | Server terminology integration | Term-only training/demonstration, query/contract/transfer review; assess technical minimization / DPO | Unassessed |
| R05 | Provider compromise or unassessed transfer exposes records | 2×3=6; project evidence incomplete | HTTPS application; restricted application access | Actual regions, executed terms, subprocessors, encryption/key/access records / operations + DPO | Unassessed |
| R06 | Lost, stolen or failed backup SSD causes disclosure or unrecoverable loss | 2×3=6; encryption/custody/drill unverified | Backup/checksum and guarded restore tools; owner selected SSD | Encrypted SSD, separate key, disconnected custody, separate-location copy and measured restore / operations | Unassessed |
| R07 | Excess retention or unsafe rights delivery harms confidentiality | 2×3=6; schedule/channel unapproved | Consent/rights history and controlled export | Approved record-class schedule, holds, identity checks and secure delivery / DPO | Unassessed |
| R08 | Audit deletion or missing monitoring conceals misuse | 2×3=6; external custody unproven | Integrity chain, export verifier, reviewed route inventory | Immutable independent retention, alert/receipt tests and independent review / compliance | Unassessed |
| R09 | Downtime or poor reconciliation delays/duplicates treatment/payment | 2×3=6; no witnessed operational drill | Recovery and operations register tools | Approved recovery objectives, downtime forms, clinical/finance reconciliation rehearsal / facility lead | Unassessed |
| R10 | AI activation expands processing or generates harmful summary | 2×3=6 if activated; configuration/history not established | Generation helper has no source caller in reviewed application | Approve scope boundary and verify assessor build; separate provider/privacy/clinical evaluation before activation / DPO + clinical lead | Unassessed; no AI approval |
| R11 | Child or representative rights mishandled | 2×3=6; local procedure unapproved | Relationship/rights workflows | Safeguarding, authority verification and confidential-care review / DPO + clinical lead | Unassessed |

Due dates and named treatment performers: pending Edwin's scheduling. Complete each treatment's evidence ID, result, residual L/I, reviewer and acceptance/required-change decision. Unresolved high risk must be escalated for the DPO's determination of applicable consultation and other legal requirements; do not silently lower a score to close a gate.

## Retention, processors and patient notice

Use [privacy decision schedules](PRIVACY-DECISION-SCHEDULES.md) for record classes, provider/transfer evidence and notice wording. Owner directs retention to follow applicable MOH guidance and other handling to follow Kenyan law. Charles is the SSD custodian and keeps it away from the computer; encryption and separate-site status remain unverified. The SSD choice changes custody, not the retention authority. Deletion must account for legal holds, exports, device copies, provider logs and eventual backup expiry. After a restore, reapply authorized restriction/deletion records before use so erased/restricted records are not unintentionally reintroduced. No production deletion is authorized by this draft.

## Consultation and approval record

| Consultation | Question / evidence requested | Actual participant/date/outcome |
|---|---|---|
| Clinical, nursing, laboratory, pharmacy | Accuracy, minimum data, confidentiality, children and downtime safety | Not recorded |
| Registration, records, finance | Identity, correction, reporting, recipient checks and reconciliation | Not recorded |
| Patients/representatives or suitable representatives | Notice comprehension, access barriers, confidentiality and rights channels | Not recorded; DPO must document approach and any justified limits |
| Operations/security | Provider controls, SSD custody, key recovery, restore, audit and incidents | Not recorded |
| DPO and controller representative | Bases, transfers, residual risk and required regulatory steps | Not recorded |

Decision options: approve defined scope; approve only after specified conditions; require redesign; or reject. Record assessment version/hash, conditions, unresolved objections, residual-risk rationale, controller decision, DPO advice, dates and next review trigger. Signatures: Edwin pending; Charles pending; qualified clinical and technical reviewer pending. Review on provider/region changes, AI or national integration activation, new data uses/facilities, serious incident or material scope/control change. No gate status is changed by this document.
