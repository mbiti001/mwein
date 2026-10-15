# Triage and shared vital measurements

16 October 2026 · Engineering workflow correction; clinical and regulatory acceptance remain separate.

The owner requested one logical workflow and no repeated measurement entry, then specified the menu name **Triage** with **Vitals** inside it. The former separate Triage/Vitals destinations exposed overlapping screens. Clinical triage also stored observations without putting newly taken measurements into the shared measurement history. Manual reuse could clear pain/consciousness, and modified imported values could retain the original source ID.

## Result

| Situation | Behaviour and retained evidence |
|---|---|
| Measurement-only staff | One Triage destination, Vitals capture/history only. Saving does not complete clinical triage or change urgency. |
| Clinical assessment | Latest saved readings load once, automatically, unless the user has begun editing measurements. Concern, pain, consciousness, category and other assessment entries remain intact. |
| Complete recorded set | Readings are read-only and reused by their original record ID. No extra measurement row is created. |
| Partial recorded set | Existing readings remain read-only. Staff enter only missing measurements actually taken. Completion creates one new set; its note retains the original recorder/time and names additions, and its audit evidence retains the source-set ID. The original set is unchanged. The completion time is labelled separately from the original measurement time. |
| New measurements | An explicit new-set action keeps clinical assessment entries and original history. Completing triage saves the new shared set, assessment, observations, queue handoff and audit events atomically. |
| Repeat reading | Open visits remain selectable after initial triage and in direct-review pathways. Standalone capture still requires `vitals.write`; `triage.write` alone grants reading and clinical assessment, not standalone capture. |
| Failure/retry | A pending write blocks accidental navigation. An uncertain response retains the exact request/key for retry. Same actor/payload retries confirm the saved result without new rows. Altered requests are rejected. A confirmed save remains confirmed when a subsequent list/history refresh fails. |
| Patient change | Draft-discard confirmation protects entries. Accepted discard clears the visit-specific draft. Late source reads cannot overwrite edited measurements, and late save callbacks check the selected visit. |

The open-visit worklists use tables. Measurement entry and history share field order, blue-and-white styling, attribution and explicit missing-value labels. Desktop, tablet, 390/320 px phone and print scenarios are included in browser verification. No clinical thresholds, urgency categories or permission assignments were introduced or broadened.

## Verification

- Handler tests cover complete/partial/new sets, source tampering, foreign visits/facilities, role/MFA boundaries, closure, exact replay and audit failures. The independent reviewer supplied additional handler assertions.
- The isolated synthetic database fixture injects an audit failure and verifies rollback of measurements, assessment and handoff. Concurrent capture/triage retries must create exactly one appropriate set/assessment/queue, while complete-source reuse creates no additional set and partial completion preserves originals and durable linkage.
- Real-browser reception-to-nurse cases verify automatic reuse, partial completion, a lost successful response, repeat readings and protected navigation. Mocked failure cases verify delayed source reads, draft replacement confirmation, triage-only permissions, refresh recovery and responsive layouts.
- Source/build identities and final counts are recorded in the release candidate evidence and workflow log. A local passing test is not a production release or clinical UAT acceptance.

## Reference and acceptance boundaries

The [WHO triage overview](https://www.who.int/tools/triage) distinguishes acuity assessment from simple recording; it does not authorize this application's existing thresholds or category scheme. The [Kenya Ministry of Health clinical guidelines catalogue PDF](https://health.go.ke/sites/default/files/2025-04/Clinical%20Guidelines%20for%20Management%20Level%204%20Primary%20Care%20Hospitals%20Level%205%20Secondary%20Hospitals%20Level%206%20Tertiary%20Hospitals%20%E2%80%93%20National%20Hospitals.pdf) provides national clinical context, subject to qualified local review. No rules were imported from a search excerpt; the Level 2/3 PDF fetch timed out during this run. The external [HosiPoa module directory](https://www.hosipoa.co.ke/modules/) was reviewed as a workflow reference, not an approval or clinical standard.

The [seven-document legal baseline](assessment-pack/MWEIN-LEGAL-CONTROL-MATRIX.md) and [DHA requirements register](assessment-pack/DHA-HIE-REQUIREMENTS.md) remain controlling assessment inputs. Public [HIE documentation](https://hie-docs.dha.go.ke/) is not permission to transmit. Contracts, sandbox evidence, UAT and DHA acceptance remain required. No integration was enabled, patient record exercised in production, credential changed, production seed run or third-party message sent. MFA, clinical readiness, backup and restore acceptance gates remain intact. No schema/migration changes are part of this batch; the October 15 backup exception is not reused.

## 1.6.1 flag correction and coverage limit

The 1.6.0 audit checked stored measurement values, links and handoffs but missed observation flag semantics. Its inherited blanket abnormal flag could mark unrelated readings abnormal. The patch assigns each observation only its own existing configured-rule result; weight/height have no existing isolated rule and are not thereby certified clinically normal. Alert thresholds/messages/severity remain unchanged. New tests check actual persisted per-code abnormal/critical flags using independent expectations. Original completed assessments and retry receipts remain immutable; this correction applies to new writes. Any historical review/correction is separate governed work, not a silent database rewrite.
