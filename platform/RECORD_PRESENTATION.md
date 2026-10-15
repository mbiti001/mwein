# Saved records and printing

Saved records use the same blue-and-white visual language as entry forms: related labelled values sit beside one another, narrative text spans the available row, and narrow screens stack fields without clipping. `RecordFields` supplies the shared value and section presentation. The rendered record is also the source for printing; printing does not rewrite stored or signed data.

## Value rules

- Omit null, undefined and whitespace-only optional values. Omit a group when none of its fields has a value.
- Keep zero, explicit false/No, true/Yes, normal findings, negative findings and explanations.
- Remove exact unassessed placeholders only from history/examination/specialty finding fields explicitly configured for that behavior. Never apply that filter indiscriminately to workflow status or safety warnings.
- Keep missing financial values distinct from zero, pending investigations/dispensing, unverified or draft status, missing medicine-course warnings, signers, timestamps, correction links and document fingerprints.
- Do not infer units, diagnoses, approval or clinical normality from an omitted value.

## Surfaces

| Surface | Presentation |
| --- | --- |
| Visit summaries | Recorded history/examination cards, specialty fields and medicine details; empty diagnoses, orders, medicines and follow-up fields omitted; pending orders retained. Empty addendum authoring stays available on screen but is excluded from print. |
| Clinic forms | Sick sheet, maternity delivery record, delivery note and gate pass share labelled fields; narrative fields span a row. Signed attribution and revision history remain. |
| Purchase order / goods receipt | Supplier/contact/document metadata use the shared grid. Empty optional notes/contact fields are omitted. Quantities, unknown costs, approval status and actors remain. Audited print preparation and immutable receipt snapshots are unchanged. |
| Laboratory / imaging reports | Patient/report metadata and recorded report content use compact columns; optional blank technique/comment/recommendation fields are omitted. Results tables, abnormal flags, reference caveats and verification attribution remain. |
| Pharmacy | Saved prescription details use labelled fields. Missing course/indication remains explicit during dispensing review. The existing 90 mm medicine-label format is retained. |
| Billing | Receipt metadata uses shared fields; invoices keep comparable line-item/totals tables. Payment reversal controls are excluded from print. Zero totals remain visible. |
| Referrals | Recipient and clinical information use labelled fields; absent appointment/feedback blocks are omitted. Referrer and acknowledgement history remain. |
| Specialty assessments | A separate saved snapshot presents only saved values, grouped under the same sections as entry. The editable assessment and its validation remain available. |
| Local aggregate reports | Review/frozen worksheets render saved values rather than disabled input boxes. Zero and missing counts stay distinct; review and correction controls are unchanged. |
| Monthly reporting / surveillance history | Attendance counts and history details use labelled fields. An empty diagnosis table is omitted. Editing local drafts is excluded from report printing. |
| Vitals / registration | Existing grouped registration and aligned capture/saved measurement grids are retained. Missing vital values retain their comparison slots and explicit labels. |

Worklists, line-item tables and governance evidence retain their existing operational structure where an empty/missing/pending state itself communicates required work. This presentation change does not alter permissions, facility predicates, clinical rules, national report mappings or audit events.

## Verification

Semantic tests cover absence, zero, false, explicit negatives and explained limitations, plus all four signed clinic-document kinds and their attribution. Browser scenarios cover saved/print parity, desktop/tablet/phone layouts, generated A4 PDFs, supply preview/print intents and unchanged workflow boundaries. The public sign-in image is checked at 1440, 1024, 768, 390 and 320 px for complete rendering and non-overlap with the sign-in form.

Physical printer acceptance, clinician/finance review and production readiness approval remain separate from browser PDF checks. Consult `WORKFLOW_IMPROVEMENT_LOG.md` and the release evidence for exact validated source and results.
