import path from "node:path";
import { collectCertificationSource } from "./certification-source.mjs";

const args = process.argv.slice(2);
let ref = "HEAD";
let allowDirty = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--allow-dirty") allowDirty = true;
  else if (args[index] === "--commit" && args[index + 1]) ref = args[++index];
  else throw new Error("Usage: certification-evidence.mjs [--commit <ref>] [--allow-dirty]");
}
const repo = path.resolve(import.meta.dirname, "../..");
const source = collectCertificationSource({ repo, ref, allowDirty });
const controls = [
  ["release_identity", "IMPLEMENTED", "Immutable commit is exposed by /api/health and verified with ops:release-verify"],
  ["platform_ci", "IMPLEMENTED", "Platform verification runs types, tests, migrations, build, integration and browser checks"],
  ["safe_registration", "IMPLEMENTED", "Standard, guardian-assisted and unidentified-emergency registration are modelled"],
  ["consent_lifecycle", "IMPLEMENTED", "Versioned lawful basis, representative authority, grant and withdrawal are auditable"],
  ["odpc_registration", "EVIDENCE_AVAILABLE", "MWEIN MEDICAL SERVICES Data Controller registration 112-9801-11EB is valid from 2026-09-22 through 2028-09-22; retain the protected certificate outside Git"],
  ["clinical_read_audit", "PARTIAL", "Core patient, visit, result and consent disclosures are covered; maintain endpoint inventory"],
  ["oidc_mfa", "EXTERNAL_EVIDENCE_REQUIRED", "Provider credentials, callback implementation and MFA/deprovisioning acceptance remain required"],
  ["encryption_key_management", "EXTERNAL_EVIDENCE_REQUIRED", "Hosting, database, backup and key evidence cannot be proven from source"],
  ["odpc_dpia", "EXTERNAL_EVIDENCE_REQUIRED", "ODPC registration, DPIA, processor terms and approved policies require accountable owners"],
  ["kenya_core_fhir", "EXTERNAL_EVIDENCE_REQUIRED", "Confirm profiles and validate exchanges in the DHA sandbox"],
  ["public_health_reporting", "EXTERNAL_EVIDENCE_REQUIRED", "Approve datasets, urgent notifications and acknowledgement workflow"],
  ["clinical_validation", "EXTERNAL_EVIDENCE_REQUIRED", "Named clinical owner must execute and sign the hazard-based UAT set"],
  ["penetration_test", "EXTERNAL_EVIDENCE_REQUIRED", "Independent laboratory/security assessment and remediation evidence required"],
];

const result = {
  generatedAt: new Date().toISOString(),
  application: "mwein-hmis-platform",
  ...source,
  controlsProvenance: "Collector checklist only; these descriptions are not validation results for the selected source or deployed runtime.",
  controls: controls.map(([code, status, evidence]) => ({ code, status, evidence })),
  declaration: "Engineering evidence index only. It is not DHA certification, legal approval or clinical acceptance.",
};
console.log(JSON.stringify(result, null, 2));
