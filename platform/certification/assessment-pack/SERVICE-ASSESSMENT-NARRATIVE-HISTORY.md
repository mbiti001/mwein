# Assessment narrative history and attribution correction

21 October 2026. Baseline `fae2ac5c2d1a6b8b2673a8d60bb9a85136eead40`, owner-renamed branch `codex/mwein-platform`. This implements the existing-narrative read and attribution portion of [the history contract](SERVICE-ASSESSMENT-HISTORY-AUDIT.md). It does not implement the separate structured revision model or its migration.

## Result

The service-point worksheet previously omitted saved encounter addenda. It now privately returns and displays the latest twenty narrative addenda from **all encounters belonging to the authorized visit**, including an older signed/corrected encounter beside a newer draft. Ordering is `createdAt DESC, id DESC`; a twenty-first row detects truncation. The response and screen distinguish an audited empty result from unavailable data. Author, facility-zone time, reason, encounter reference and addendum reference accompany the text. Only the author's display name is selected; staff contact/account details are not returned.

The compact blue-and-white fields use two columns at desktop/tablet widths and one on small phones, with full-width reason/text. Print includes saved patient/visit identity, loaded narratives, attribution and explicit truncation/unavailable notices. Unsaved fields and controls remain hidden. Narrative text does not replace the structured assessment, risk or follow-up, and the view says that earlier structured versions are unavailable. This is a bounded view, not a complete chart export; older notes beyond twenty remain stored but are omitted from this view and printout. Paging remains future work.

Assessment replacement remains rejected on SIGNED/CORRECTED encounters. Its error now directs staff to review saved assessment/addendum history instead of recommending a write that the CORRECTED addendum endpoint does not support. No new amendment controls or lifecycle permissions are introduced. Existing addendum POST acceptance/closure behavior is preserved, not newly approved.

Future narrative audit events include authenticated facility, user and session, plus `addendum-v1:` followed by SHA-256 of JSON serialization of `[version, facilityId, visitId, addendumId, encounterId, authorId, persistedReason, persistedText, createdAtUTC]`. The fingerprint uses the persisted create result. It is integrity evidence, not an encrypted history store. Existing events remain unchanged. The narrative row and its audit still share one transaction; no automatic retries or idempotence claims are added. The POST response is now private/no-store.

## Authorization and failure boundaries

- Existing `encounter.write`, visit/facility gates and MFA apply. The narrative query independently constrains visit and facility and includes only the selected visit's records.
- Before response, existing disclosure auditing binds the visit, relationship IDs and the exact returned addendum IDs to the authenticated session. The extra truncation-probe row is not returned or claimed as disclosed.
- Failed narrative query or disclosure audit returns an error without assessment/narrative data. UI shows unavailable rather than falsely reporting no notes; keyboard retry uses the existing fail-closed assessment reload.
- Failed addendum audit rolls back the newly created narrative. Assessment values, prior events and addenda remain unchanged. No data repair or historical hash/session backfill occurs.

## Verification

The new read regressions first failed on the original behavior: two failures and 46 passes. Corrected focused checks pass 66 tests; complete local unit suite passes **1,288 tests in 129 files**. Types, **55 migrations**, full dependency audit (**zero vulnerabilities**) and production build pass. Local build identifier: `Tz-KbQ67MNBmhcFAWjF9r`. Browser and native test evidence is finalized in the companion JSON/workflow log after completion.

The standalone native PostgreSQL run passes **196 checks**. New acceptance assertions independently reconstruct the persisted narrative digest, resolve its session, verify returned text/author/encounter and disclosure-ID fingerprint, deny reception/foreign-facility reads/writes, inject write/read audit failures, and verify deterministic truncation with older-encounter inclusion. SQL creates synthetic final states and extra tied-timestamp records; these are test fixtures, not clinical-signing workflow or API-provenance claims. Prior stale-editor/signer/concurrency and MFA regressions remain active.

Remaining explicitly named characterization tests continue to show loss of prior structured text and non-idempotent repeated narrative submission. They are not acceptance of these gaps. Changed-payload replay, reviewed post-signature structured corrections, migration baselines, append-only relational constraints and restore verification belong to the structured-history implementation. Do not conflate passing narrative checks with completion of that contract.

## Release and next work

Read-only live health before work confirms the completed original release: **1.6.2 / `89e693df430571b9371cefad7db1e750ae41fe30` / `dpl_F3uShagMUnYftappZnbrmSdTf42T`**, connected database and migration `20261016010000_rights_identity_evidence`. This candidate and preceding financial/assessment corrections remain undeployed. No schema, migration, dependency or version change, production operation, patient exercise, seed, credentials change or third-party message is performed. Separate cancellation PR #11 remains untouched.

Next implement retained structured assessment revisions and reviewed amendment semantics from the existing contract, with fresh backup and restore evidence required for a later production database release. The October 15 backup exception is not reusable. Then complete unsaved navigation/reload protection and retained payment/dispensing/supply session attribution, changed-payload stock replay, diagnostic offered/accepted handover, pharmacy clarification, cashier/reversals and attributable follow-up work. MFA, clinical readiness, external clinical/legal/DHA/security acceptance and coordinated release checks remain.

## Primary reference scope

[WHO Digital Adaptation Kits](https://www.who.int/publications/m/item/who-digital-accelerator-kits) were rechecked for the distinction between workflows/data requirements and clinical recommendations. [HosiPoa modules](https://hosipoa.co.ke/modules/) were rechecked as a connected-department product reference, not a clinical standard. Initial HosiPoa retrieval timed out; the second succeeded. The [Kenya MoH public-participation notice](https://www.health.go.ke/node/1512) again failed direct retrieval; no current-law claim is based on it. Existing approval gates remain. This batch corrects engineering record visibility and attribution without inventing clinical thresholds, standards or approvals.

Local full-browser verification passed 153 scenarios with no retries. A screenshot-only refinement passed all 18 assessment browser scenarios. Desktop/tablet/390/320 captures were visually reviewed; all three rendered PDF pages were inspected and text verification retained 75 numbered narrative lines, identity, author, reason and truncation notice without unsaved markers. Initial sticky-header-obscured screenshots and a failed out-of-viewport clip attempt are preserved; full-document coordinate capture corrected only the evidence capture. Missing pdftotext was handled with bundled pypdf, while Poppler rendered the pages. No physical print approval is claimed.

## Final hosted evidence

Exact source `4a1682c423277f428e2b617641f1639662126c0e` passed [CI 39571955042](https://github.com/mbiti001/mwein/actions/runs/39571955042), aggregate and both jobs (Platform119128068773, Legacy119128068412). Retained decoded logs establish 1288 units/129 files,55 migrations,196 native checks,153 browsers with zero retries, build and zero full dependency advisories. Source archive:7034880bytes, SHA256 `53ef89be5304caf8ec102765cfef214a53734fa754e3b7e501b4f4f1d6137b95`; canonical source inventory73/0gaps/0unclassified/0aliases. Only the two changed routes have refreshed source fingerprints; no exceptions were added. The five changed application files match the archived pushed source. Local pre-commit build and hosted exact-commit build are separate; no hosted build ID is claimed.

[Companion evidence](SERVICE-ASSESSMENT-NARRATIVE-HISTORY-EVIDENCE.json) records tests, source, CI steps, log hashes, release status and boundaries. Final public health retains original1.6.2/89e693d/dpl_F3uShagMUnYftappZnbrmSdTf42T; /api/ready remains503blocked. The first readiness probe used the wrong /api/readiness path and returned404; this probe mistake is retained and is not treated as a service regression. All local fixture listeners stopped; databases and raw evidence remain retained. No authentication was required. This candidate remains undeployed.
