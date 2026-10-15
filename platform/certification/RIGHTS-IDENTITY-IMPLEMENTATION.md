# Mwein rights identity and representative verification

16 October 2026 · Version 1.3.0 candidate · Engineering controls, not legal or clinical approval.

## Staff workflow and scope

A privacy officer records the requester reference, protected identity-check reference, representative relationship and authority reference where applicable, authority scope, assessment and attestation. The server binds this evidence to the patient, facility, request type and request ID, with the signed-in officer and server time. Do not enter identity scans or document numbers here. An evidence reference requires a real approved verification procedure and protected evidence store; typing a reference does not establish identity by itself.

The previous evidence-free identity status transition is rejected. Review, demographic correction and completion require retained verification. Full patient-record preparation and regeneration additionally require explicit full-export scope; review-only authority cannot export. Delivery must use the verified recipient and representative authority, with a fresh delivery identity-check reference and separate receipt evidence.

Saved fields use the shared responsive record layout, omit absent optional fields and retain attribution. Open forms are excluded from print. Browser failure preserves entered fields. Exact retries by the same officer return the original verification; different content, request key or officer conflicts. A confirmed save followed by failed history refresh requires reload, without resubmission.

## Integrity, migration and legacy records

Required migration: 20261016010000_rights_identity_evidence. The nullable JSON column preserves legacy history without fabricating evidence. Database checks bind evidence to its request; the trigger freezes evidence and original request identity, details and receipt/deadline after verification. All request mutations share the existing export row lock. Audit failure rolls verification back. Protected reads and writes retain privacy.manage permission and patient/facility predicates.

Older open requests with an identity/review status need evidence before further review, correction, export or delivery. Verification clears any earlier prepared-response reference and time; the prior reference remains in the audit event. A new response must then be prepared against the verified authority. Original receipt and deadline are unchanged. Closed historical requests are not backfilled or reopened.

If retained authority is wrong, changed or revoked, cancel the open request before any further disclosure and use a separately reviewed request preserving the original receipt time. Do not overwrite evidence or treat the new entry time as a new deadline. A dedicated linked amendment/revocation workflow remains in the pipeline. This release does not implement selective export/redaction, automate authority validation, or make the existing full export a complete statutory access response.

## Verification and release boundary

Unit/API tests cover malformed/missing evidence, wrong patient/facility binding, limited scope, changed actor/body replay, audit failure and wrong delivery recipient. The synthetic database fixture additionally covers concurrency, rollback, immutable evidence, legacy re-verification and an independently authorized officer from another facility. Browser tests cover failed/lost responses, exact retries, original overdue dates, desktop/tablet/phone layout and print behavior.

A fresh verified retained backup, exact-source CI and controlled migration are required before the candidate is deployed. Do not reuse the October 15 backup exception. Production remains at the separately recorded 1.2.0 release until promotion evidence says otherwise. Existing MFA, independent assurance and clinical readiness gates remain.

## Sources and remaining legal work

The supplied legal baseline is mapped in [LEG-02 and LEG-05](assessment-pack/MWEIN-LEGAL-CONTROL-MATRIX.md). Current [ODPC rights guidance](https://www.odpc.go.ke/rights-of-a-data-subject/) describes parental/guardian and duly authorized representative handling. The [2025 health-information procedures source](https://new.kenyalaw.org/akn/ke/act/ln/2025/76/eng%402025-04-11/source) provides the regulatory reference for authorized access. These inform proportionate evidence handling; accountable legal/clinical reviewers must approve applicable procedures.

Restriction/objection/erasure, written refusal evidence and timing, supplementary access information, third-party redaction, child/representative policy acceptance and independent security evidence remain open. Local rights verification is separate from national HIE consent; see the [DHA HIE requirements register](assessment-pack/DHA-HIE-REQUIREMENTS.md).
