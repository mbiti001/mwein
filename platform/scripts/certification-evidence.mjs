import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const migrations = readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort();
const controls = [
  ["release_identity", "IMPLEMENTED", "Immutable commit is exposed by /api/health and verified with ops:release-verify"],
  ["platform_ci", "IMPLEMENTED", "Platform verification runs types, tests, migrations, build, integration and browser checks"],
  ["safe_registration", "IMPLEMENTED", "Standard, guardian-assisted and unidentified-emergency registration are modelled"],
  ["consent_lifecycle", "IMPLEMENTED", "Versioned lawful basis, representative authority, grant and withdrawal are auditable"],
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
  commit,
  latestMigration: migrations.at(-1),
  migrationCount: migrations.length,
  controls: controls.map(([code, status, evidence]) => ({ code, status, evidence })),
  declaration: "Engineering evidence index only. It is not DHA certification, legal approval or clinical acceptance.",
};
console.log(JSON.stringify(result, null, 2));
