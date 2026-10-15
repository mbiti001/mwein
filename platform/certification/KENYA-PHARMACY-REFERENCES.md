# Kenya pharmacy references and implementation boundaries

Reviewed 16 October 2026 (Africa/Nairobi). This engineering register adds to Mwein's legal-control and DHA HIE registers; it is not clinical, PPB, legal or certification approval.

## Verified sources

| Source | Review evidence | Use in Mwein |
| --- | --- | --- |
| [Ministry of Health, Kenya Essential Medicines List 2023, WHO-hosted copy](https://extranet.who.int/cpcd/sites/default/files/public_file_repository/KEN_Kenya_Kenya-Essential-Medicines-List-2023_2023.pdf) | 146-page PDF; SHA-256 a31ee93022d6f73ae5e2b6f94b4f1a427090ade50ba733aa7acb427f1c88fa5f. Printed pages 12, 14, 19, 20, 50 and 64 visually checked against the extracted table and footnotes. The [WHO national list repository](https://www.who.int/teams/health-product-policy-and-standards/assistive-and-medical-technology/essential-medicines/national-emls) lists Kenya 2023; this review did not verify a later Kenyan edition. | Fourteen selected formulations, each retaining section, printed page and level of use. Generic names, salts, combination components and dosage forms are preserved. This is a starter naming reference, not the complete national formulary. |
| [PPB Good Pharmacy Practice Standards, 2026 edition](https://web.pharmacyboardkenya.org/download/good-pharmacy-practice-gpp-standards/) | Official landing page posted 18 September 2026 and updated 21 September 2026; GOOD-PHARMACY-PRACTICE_GPP_2026_PPB.pdf, 3,995,110 bytes, SHA-256 9593e03406a77fc014ff63981a620125714eb8da38805e195fb41b74056ce8ab. Reviewed Standard 3, printed pages 36–39. | Current PPB engineering reference for prescription completeness, safety review, labelling, counselling and medication records; this review is not an assessment of the entire publication or proof of facility compliance. |
| [PPB earlier Good Pharmacy Practice draft download](https://web.pharmacyboardkenya.org/download/guidelines-for-good-pharmacy-practice-in-kenya/) | Page updated 12 August 2025. File named GPP_9th_DRAFT_FEBRUARY_2025.pdf, SHA-256 afc4c40f15d420afa11b60615c1dab7e8e20af7b4e9eec9c4cecbf7c8ec0e693. Cover says March 2025; approval page has placeholder effective/review dates. Final adoption was not established. | Historical background, superseded as the primary engineering reference by the published 2026 Standards above. Do not assert this draft is operative regulation. |
| [PPB product portal](https://products.pharmacyboardkenya.org/) and [marketing authorization responsibilities](https://www.pharmacyboardkenya.org/registrationretentionvariations/) | Official verification destinations, not an authenticated register integration. | Staff must verify the actual marketed product; a KEML listing is not brand registration or a licence. |
| [PPB 2026 rapid alerts](https://web.pharmacyboardkenya.org/rapid-alerts-2026/) and [safety alerts](https://web.pharmacyboardkenya.org/safety_alerts/) | Reviewed current indexes, including product/batch-specific falsification alerts. No complete live recall feed was verified. | Catalogue links support current checks. Do not turn a named batch alert into a ban on an entire generic medicine. |
| [WHO Medication Without Harm](https://www.who.int/initiatives/medication-without-harm) | Current primary safety programme. | Clear information transfer, review of multiple medicines and patient involvement; no dose rules inferred. |

Source PDFs and rendered comparison pages are retained in the local work/kenya-pharmacy-sources directory. Public reference data is bundled locally; opening a consultation does not send patient information to an external source.

## Implemented controls

The catalogue reference picker prepares an **inactive** item through the existing facility-scoped, permission-controlled and audited catalogue endpoint. It supplies names and provenance; the operator must enter the issue unit and review price, product registration, release formulation, facility scope, source footnotes and current alerts. Selection does not write to the database. No production seed or bulk activation runs.

The prescription composer supports up to 20 distinct medicine lines, explicit dose/route/frequency/duration/instructions, compact saved records and reachable save/send actions. It does not preselect a clinical dose. Counts are calculated only for tablet/capsule issue units; other preparations require manual quantity verification. Draft review retains order identity; sent corrections require a clinical reason and an unchanged saved revision. A supplied or in-progress medicine cannot be overwritten.

List saves are transactional. Per-line save keys are unique; exact retries require matching actor, facility, visit and parsed request fingerprint. Changed retries conflict. Audit failure rolls back the list. Prescribing does not charge unsupplied medicines. This adds no database migration.

Replacement candidates retain existing ingredient/concept, strength and dosage-form matching and now require a recorded, matching issue unit and nonempty identity. The UI describes these as matching formulary items, not independently proven therapeutic equivalents. Existing pharmacy permission, reason, counselling, FEFO, stock, transaction, billing and audit controls still apply. Clinical substitutions involving a different ingredient, strength, form or unit are not automatically suggested.

## Mapping the September 2026 PPB standard

| Requirement in Standard 3 | Current implementation and acceptance gap |
| --- | --- |
| 3.1.2–3.1.5, printed page 36: readable prescriptions, unique prescription serial and required particulars | Typed multi-medicine records now have consistent directions and attribution. A dedicated prescription-level serial, prescriber registration/signature validation and complete prescription export remain in the structured-numbering pipeline. Existing visit/order identity is not claimed to satisfy the prescription serial requirement. |
| 3.1.7–3.1.15, printed page 37: authorized review, recipient identity, prescription validity, dose/contraindication/interaction checks and clarification | Existing role/facility checks and safety-rule infrastructure are retained. This batch evaluates all proposed medicines together, prevents stale overwrites and preserves prior directions. Clinical rule coverage, professional registration verification, recipient confirmation and an attributable clarification queue require independent acceptance and further work. |
| 3.2.1–3.2.10, printed pages 37–38: product quality, appropriate supply quantity and complete labels | Catalogue references preserve generic name, form and strength; replacements also require a matching recorded issue unit. Liquids and packs require explicit quantity verification. Full label-content, expiry/advisory and actual product/release-form validation remain acceptance items. A matching name is not proof of interchangeability. |
| 3.3, printed page 38: counselling and attributable supply | Existing counselling and dispensing audit controls remain. Patient-facing summaries now omit draft/cancelled/unknown-status medicine orders; staged edits are excluded from print. Patient-language information and signed dispensing-copy acceptance remain pending. |
| 3.4, printed page 39: complete, confidential medication records and retention | Atomic saves and attributable revision history retain existing access/audit controls. Map the stated minimum five-year prescription retention from dispensing to the broader approved Kenyan health-record schedule and legal holds before setting any deletion rule. No retention period or deletion job changed in this batch. |

The standards support generic substitution in their service context but this review did not establish a product-level interchangeability list. Mwein therefore adds no therapeutic substitution or automatic dose conversion. The [MoH June 2026 digital pharmaceutical regulation announcement](https://health.go.ke/moh-reaffirms-commitment-stronger-pharmaceutical-regulation-and-digital-health-transformation) is recorded as a dependency to verify current Track and Trace, Practice360 and Facility360 contracts and availability. An announcement is not a tested integration contract; no national endpoint is enabled here.

## Remaining governed work

- Pharmacist acceptance of the reference entries, exact product registration and nomenclature mapping; expansion to the rest of KEML with independently reviewed restrictions.
- Explicit product release characteristics, approved equivalence mappings, substitution consent and return-to-prescriber/clarification ownership.
- Current signed treatment/antimicrobial policies, versioned dose and interaction rules, contraindications, renal/pregnancy/paediatric checks and independent clinical validation. This reference list does not provide those rules.
- Verified PPB recall ingestion, batch quarantine evidence and national terminology/registry contracts through the DHA HIE pipeline.
- A full national formulary or production-ready clinical decision support must not be inferred from these engineering changes.
