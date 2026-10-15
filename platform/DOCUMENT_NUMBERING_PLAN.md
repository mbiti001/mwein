# Mwein document numbering

Requested by the owner on 15 October 2026. This work is added to the pipeline while the frozen 1.1.0 release proceeds.

Saved document lists, detail headings and printed documents should show a readable serial, for example `MMS-SICK-2026-000001`, with separately labelled patient, status and revision fields. UUIDs remain internal record identities. The example is a proposed format, not an issued document number or a requirement from a regulator.

Implementation must allocate numbers on the server, atomically within the document-and-audit transaction. Scope the sequence to facility, document type and year in the facility's configured timezone; enforce database uniqueness and test simultaneous creation and retry. Never infer the next number from the number of records, recycle deleted/cancelled numbers or promise a gap-free sequence. Preserve permission checks and facility isolation before allocation.

Corrections must preserve the signed original, its content hash and reference, with a traceable successor and an explicit revision label. Do not rewrite historical signed references merely to change their appearance. Decide and document how legacy references are presented without breaking existing lookup, exports, printed copies or audit evidence. Do not truncate UUIDs and describe the result as a sequential serial.

Apply the same compact, related-field layout to document lists, saved summaries and print. Verify long patient names, desktop/tablet/phone widths, missing optional values, print wrapping, signed/corrected history, concurrent creation, exact retries, cross-facility rejection and audit rollback using synthetic data. The design should be reusable for other issued documents after their existing numbering and integrity rules are reviewed.

Release boundary: implement and test in a subsequent numbered release, with a fresh verified backup if a schema change is required. This request does not replace the ongoing compliance, diagnostic, pharmacy, cashier and follow-up work.
