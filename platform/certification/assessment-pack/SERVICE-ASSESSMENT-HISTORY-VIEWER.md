# Structured assessment history viewer and selected-version printing

22 October 2026. This batch connects the existing audited history endpoint to the service-point worksheet. It is engineering work, not clinical, regulatory or deployment approval.

Authorized staff can load saved versions on demand, select a version, and navigate older/newer pages. The viewer retains one page of at most twenty snapshots and a cursor stack; it does not cache clinical values in browser storage. Requests are aborted when leaving the record. Every page uses the existing permission/password/MFA, facility/visit/record/encounter scope and disclosure audit. No route, schema, migration, authorization or clinical rule changes are introduced here.

Selected history remains separate from current saved values and the editable draft. A successful save or assessment reload remounts the viewer and clears the selection. Changing pages, reloading or encountering a failed history read clears displayed history and its print target. Errors are explicitly unavailable, with keyboard-accessible retry of the same cursor. Empty retained history does not assert that no earlier assessment existed. Cross-visit/record responses are rejected before display. These UI checks supplement server authorization; they do not replace it.

The selected snapshot preserves version/predecessor, assessment/encounter/snapshot references, original values, template identity, recorder ID and current linked name, source creation/save time, capture time and available/unavailable session attribution. Raw session IDs remain server-side. Migration baselines explicitly distinguish capture time and missing original session/earlier revisions. Unknown historical templates display original keys rather than assigning current labels/units; extra saved keys remain visible. False, zero and absent values remain distinct.

Current and historical snapshots share field rendering, in the same section/order and two-column desktop/tablet layout as the entry form, collapsing to one column on narrow phones. Blue-and-white styling is retained. The default print remains current saved assessment plus loaded narrative addenda. An explicit checkbox selects one retained version for printing, with a visible scope statement. Its printout excludes the current assessment, narrative addenda, unsaved controls and pagination, retains patient/visit identity and attribution, and permits long saved content to span pages. Selecting another version clears the print target. A retained version is never labeled a complete record or a statement of current care.

## Verification

Companion evidence records exact source/build/archive/CI and final counts. Unit rendering tests cover missing values, zero/negative values, unknown-template labels, extra keys and escaped text. Browser checks exercise on-demand read, stable cursor paging, keyboard retry, empty versus unavailable, 401/403/404/500, cross-visit response rejection, save invalidation, abandoned-request isolation, corrected read-only records, 1440/768/390/320 layouts and selected-only multi-page PDF output. The real authenticated browser fixture saves two versions, uses the actual audited endpoint to view/print the original, preserves current entries and clears history after sign-out/read failure. Existing native API tests retain role/facility/MFA denial, persisted snapshot values, page audit fingerprints, audit-failure withholding and immutable storage checks; this batch does not claim new native concurrency behavior.

Retained setup failure: the initial dedicated native database URL omitted the synthetic fixture password required by the test safety validator. Startup was rejected before application tests. A syntactically complete synthetic URL fixed setup without changing the validator, credentials, production settings or assertions. Logs are preserved. Other failures, if any, are recorded in the final evidence.

## Release boundary and next priorities

Original Vercel release 1.6.2 / `89e693df430571b9371cefad7db1e750ae41fe30` / `dpl_F3uShagMUnYftappZnbrmSdTf42T` is already complete. This batch is not a deployment. Prior history and prescribing-default migrations remain undeployed. A later database release requires fresh backup/restore evidence, coordinated migration/writer cutover, compatible tested source and all existing MFA/security/clinical/DHA/readiness gates. The October 15 exception is not reused. No production seed, real-patient workflow, credential change or external message occurred; separate PR #11 remains untouched.

Next: reviewed post-signature amendment/narrative idempotence policy, unsaved assessment navigation/reload recovery, then retained financial/supply session attribution, changed-payload stock replay, diagnostic offered/accepted handover, pharmacy clarification, cashier reconciliation/reversals and attributable follow-up. Do not repeat completed storage, capture, disclosure or viewer work.

## Primary references checked

- [Next.js client components](https://nextjs.org/docs/app/api-reference/directives/use-client), plus the installed framework's `use-client.md`: interactive state and browser printing remain within the existing client boundary.
- [WHO Digital Adaptation Kits](https://www.who.int/publications/m/item/who-digital-accelerator-kits): workflow/data/functional engineering context, not a claim of clinical approval.
- [HosiPoa modules](https://www.hosipoa.co.ke/modules/): connected departmental workflow reference, not a clinical standard.
- [Kenya Ministry of Health portal](https://portal.health.go.ke/): direct retrieval timed out during this run. No new legal, interoperability or approval claim is made.
