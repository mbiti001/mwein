# DHA certification evidence workspace

This directory indexes evidence without claiming certification.

Start with the [DHA assessment preparation pack](assessment-pack/README.md), drafted against deployed commit `a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7`. It contains the proposed scope, requirements, manual, architecture, evidence register, UAT protocol and document checklist. Approvals remain pending.

Generate a source manifest for an explicitly selected application commit (run from `platform`):

```bash
npm run --silent certification:evidence -- --commit a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7 > /tmp/mwein-source-evidence.json
```

Use the full SHA of the intended release. Explicit selection reads only committed Git blobs, even if local edits or paused MFA drafts exist. Without `--commit`, the generator accepts only a clean checkout and selects HEAD. Save output outside the checkout so shell redirection does not introduce an untracked file before the clean-tree check. `--silent` keeps npm banners out of JSON.

Format version 2 records the resolved application commit, collection time, every committed migration, and SHA-256 hashes, Git blob IDs and byte counts for migration SQL, schema, migration lock and dependency manifests. `collection.documentCommit` identifies the checkout HEAD; `generatorSha256` fingerprints the collector actually executed. These are separate from the selected application release. Dirty status is reported without listing private local filenames. Source contents, credentials and source certificate files are not included.

The source manifest makes no control or deployment assessment. The old static `controls` claims have been removed; use the evidence register for reviewed controls and protected external records. Runtime observations must be collected separately with `npm run ops:release-verify`, setting `RELEASE_ORIGIN`, `EXPECTED_RELEASE_SHA` and `EXPECTED_MIGRATION` to the intended URL and the manifest's `commit`/`latestMigration`. Retain the dated verification result alongside the manifest. Source hashes alone do not prove that production runs those files.

## Evidence that must come from accountable owners

- ODPC registration is available outside the repository: MWEIN MEDICAL SERVICES is registered as a Data Controller, identification `112-9801-11EB`, valid 2026-09-22 through 2028-09-22. Record the protected evidence reference in the governance register; do not commit the certificate to Git.
- Approved DPIA, privacy notices, processor agreements, retention/legal-hold and data-subject request procedures remain required.
- Hosting/database/backup encryption, key ownership and access-policy evidence.
- OIDC provider configuration, MFA assurance, deprovisioning and emergency-access rehearsal.
- Measured backup restoration and downtime/incident-response exercises.
- Approved Kenya Core/domain profile versions, DHA sandbox results, KHIS/IDSR acknowledgements and SHA credentials/contracts.
- Clinician-led safety/UAT results, medication-rule approval, accessibility/usability results and independent penetration/laboratory assessment.

Never replace these documents with environment-variable screenshots or self-attestation by the development team.


[Implemented DHA controls 1–4](DHA-CONTROL-REMEDIATION.md) are available on the remediation branch with tests and rollout notes. They are not yet deployed.

[Local aggregate reporting implementation](LOCAL-REPORTING-IMPLEMENTATION.md) adds the first APP-08 workflow foundation; approved national mappings and IDSR remain outstanding.
