# Mwein release versions

The owner-designated initial release is **1**, recorded canonically as **1.0.0**. Version **1.1.0** is deployed with retained evidence; **1.2.0** is reserved for the next candidate. `versions.json` is the shared allocation ledger; `platform/package.json` supplies the running application's version. Versions identify a release series; the full source SHA and deployment ID identify an exact build. A version label alone is neither deployment evidence nor patient-use approval.

Before allocating a version, fetch the shared branch and tags and inspect this ledger. Reserve it in a normal fast-forward commit; if another contributor wins the push, reconcile their entry before retrying. Never force-push, reuse a released number for different source, or move a version tag. Use subsequent minor versions for added capabilities and patch versions for corrections after a release. Candidate refinements retain their allocated version until the tested source is frozen.

Once checks pass, create the unique `mwein-v<VERSION>` tag at the exact verified source. Check the remote tag before publishing; if it exists, its target must match. Retain the archive checksum, CI run, migration, Vercel deployment and live verification in a dated evidence file. Mark the ledger entry deployed only after promotion and identity verification. A staged candidate is not the live release.

For numbered releases set `EXPECTED_RELEASE_VERSION` alongside `EXPECTED_RELEASE_SHA`, `EXPECTED_MIGRATION` and `RELEASE_ORIGIN` when running `npm run ops:release-verify`. Keep `ops:patient-use-verify` and the existing backup, migration, MFA and approval gates. Before promotion recheck the live source against the recorded baseline so another contributor's release is preserved.

Mwein is the product name. References to other products describe external sources only. Historical Git branch names, original evidence and source URLs remain unchanged for traceability.
