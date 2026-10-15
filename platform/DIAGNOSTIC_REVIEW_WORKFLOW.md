# Diagnostic review responsibility and acknowledgement

Engineering workflow, 15 October 2026. Requires facility clinical acceptance before patient use. This does not define a clinical escalation interval, treatment rule or regulatory approval.

## Staff workflow

Open **Diagnostic review work**. The default list includes non-cancelled laboratory and imaging requests without an acknowledgement, including clinically closed visits. Filter for released reports, pending reports or acknowledged history. Search by patient name/number, visit number or test name. Browse 25 requests at a time with Next, Previous and First page; there is no 100-record reachability limit. Page numbers describe browsing positions, not complete counts or a frozen snapshot. Earlier review history remains stored when the detail view reaches its latest-50-event limit.

Requests remain ordered by their original request time and identifier. Continuation uses that pair even if an earlier request is acknowledged in the meantime; each read still applies current permission, facility and filter checks and audits its disclosed records. A filter/search change returns to the first page. Failed pages clear their rows and offer Refresh worklist; stale responses cannot replace the new search. Search is delayed briefly to avoid a request per keystroke. No search text is persisted in browser storage or added to clinical audit payloads. Use First page to check earlier work again because other staff may change the results while browsing.

The selected review and any unfinished text remain open and clearly identified while searching or paging. Selecting another record still asks before discarding unfinished work. Paging controls and search are excluded from print; saved review attribution and the verified report remain printable.

At the owner's 16 October request, the worklist uses a compact blue-and-white table with one investigation per row: patient/visit, investigation/priority, review state/closed-visit warning, owner/request time, and a labelled Review action. A selected row remains identifiable. At narrow widths the table scrolls inside a labelled keyboard-focusable region rather than squeezing fields into unreadable fragments. Worklist rows are excluded from printing a selected patient's review. Table layouts should be assessed for other suitable worklists in the remaining pipeline.

The requester is shown separately from the accepted review owner. Ordering a test, opening a report and recording critical-result communication do not automatically accept responsibility or acknowledge review. An unclaimed task explicitly says **Not accepted**.

1. A clinician accepts responsibility with a reason. A covering clinician can explicitly accept responsibility from the current owner with a handover reason. This records the incoming clinician's acceptance; it does not claim outgoing consent, send a notification or establish an external handover.
2. The owner reads the verified report and records review findings and next steps. Acknowledgement requires an explicit attestation and the exact released report identifier and verification timestamp. Drafts cannot be acknowledged.
3. The acknowledgement removes the item from outstanding work and leaves it accessible in acknowledged history. Clinical closure, payment, the original signed consultation and critical-result communication remain unchanged. Acknowledgement is not evidence of patient contact or completed care.

Only the clinician who most recently accepted responsibility may acknowledge. The current saved event ID is required for every transition. If someone else changes ownership, reload and review their saved action before continuing. The form does not silently replace another clinician's work.

## Failure and access boundaries

Both read and write access require the current facility boundary. Reading needs `clinical.results.read`; transitions additionally require `encounter.write`. Existing MFA/session controls apply. Read-only staff see the same attribution without action controls. Disclosure is audited before private/no-store responses, with the exact disclosed order and review-event IDs.

Each transition locks the facility-scoped order, reads its latest event, validates the actor/revision/report and appends the event and session-attributed audit in one transaction. A unique request UUID and fingerprint bind exact retries to their original actor and input. Replays append a new audit disclosure but no duplicate clinical event. Changed inputs or actors cannot reuse a receipt. The database independently preserves immutable events and enforces one acknowledgement per order and paired report evidence.

After an ambiguous save failure, the form locks its original request for **Retry same review action**. **Reload saved review** is an explicit discard-and-read choice; it never repeats a POST. A confirmed action followed by failed refresh stays confirmed and offers read recovery. Failed reads clear stale actionable records. Selection changes abort superseded reads; late responses cannot populate another selection. Workspace navigation and browser unload warn about entered text or an unconfirmed action. Requests are not persisted in browser storage; after a crash/reload staff must inspect the saved record before proceeding.

## Evidence and release

`DiagnosticReview` retains sequence, actor, note, recording time, report identity and exact-request evidence. The UI uses the same column order for entered and saved notes, displays missing ownership explicitly, and retains attribution in print while excluding controls and unsaved form entries. Governed patient exports include review history while omitting internal replay keys/hashes. Existing identity, representation, redaction and delivery limitations in the legal matrix still apply.

Migration `20261015210000_diagnostic_review` adds an append-only table, foreign keys, constraints, indexes and a mutation-blocking trigger. It creates no retrospective owners or acknowledgements. It is **not applied to production by this batch**. A later database release requires a newly verified backup, migration reconciliation, a tested immutable source, and all MFA/readiness safeguards. The earlier October 15 missing-backup-reference exception does not cover this migration. The separate 1.1.0 release candidate retains its own source/deployment evidence; this branch work does not change any existing deployment artifact.

Apply [the legal control matrix](certification/assessment-pack/MWEIN-LEGAL-CONTROL-MATRIX.md), particularly LEG-06/07/08/18. Database immutability is an engineering control, not independent audit custody, retention approval or clinical acceptance.

## Remaining work

- An offered handover accepted by a named recipient, facility-approved overdue/escalation targets, inactive-owner reassignment and recipient-notification evidence.
- Paginated access beyond the detail view's latest-50-event history limit, a review amendment/correction workflow and explicit linkage from review next steps into completed follow-up actions. Worklist paging/search is implemented; existing acknowledgements cannot be edited or deleted.
- Governed crash recovery and independent clinician/records/security acceptance. No automatic clinical deadlines, interpretation, treatment or external messages are introduced.

## Primary-source context

Reviewed 15 October 2026:

- [WHO laboratory quality management handbook](https://www.who.int/publications/i/item/9789241548274): laboratory process and reporting quality context. The application's ownership state machine is an engineering adaptation, not a prescribed WHO algorithm or accreditation claim.
- [Kenya Ministry of Health referral policy development update](https://www.health.go.ke/kenya-moves-strengthen-patient-referral-system-through-new-national-policy), 6 March 2026: documented continuity and accountability context. Direct retrieval timed out; the primary site's indexed article was checked. The article describes policy development, not a final interface or clinical specification.
- [HosiPoa module reference](https://hosipoa.co.ke/modules/): laboratory specimen/result and connected consultation scope. HosiPoa remains an external reference; this product is Mwein.

16 October worklist follow-up: reviewed the version-specific [Prisma 6 pagination guidance](https://www.prisma.io/docs/orm/v6/prisma-client/queries/pagination), the WHO handbook landing page and [DHA HIE index](https://hie-docs.dha.go.ke/). Direct re-fetches of the MoH and HosiPoa pages timed out; their prior context is not a new clinical specification. Search and pagination are local engineering improvements, not clinical acceptance or HIE approval. The [DHA requirements register](certification/assessment-pack/DHA-HIE-REQUIREMENTS.md) and seven-document legal baseline remain applicable; no national transport is enabled.
