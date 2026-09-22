# DHA certification evidence workspace

This directory indexes evidence without claiming certification.

Start with the [DHA assessment preparation pack](assessment-pack/README.md), drafted against deployed commit `a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7`. It contains the proposed scope, requirements, manual, architecture, evidence register, UAT protocol and document checklist. Approvals remain pending.

The current working tree contains paused, unpublished MFA work. Do not generate release evidence from that working tree. The pack includes a manifest derived directly from the deployed commit. In a clean checkout of the intended release, generate the machine-readable index with:

```bash
npm run certification:evidence > certification/evidence-index.json
```

The generated file is tied to the exact Git commit and latest migration. Release evidence is valid only when `npm run ops:release-verify` confirms that production runs that same pair.

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
