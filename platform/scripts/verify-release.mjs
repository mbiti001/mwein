import { pathToFileURL } from "node:url";

export async function verifyRelease({ origin, expectedCommit, expectedMigration, patientUse = false }, request = fetch) {
  if (!origin || !expectedCommit || !expectedMigration)
    throw new Error("Set RELEASE_ORIGIN, EXPECTED_RELEASE_SHA and EXPECTED_MIGRATION");
  const base = new URL(origin);
  if (patientUse && (base.protocol !== "https:" || base.username || base.password))
    throw new Error("Patient-use verification requires an HTTPS origin without embedded credentials");
  const response = await request(new URL("/api/health", base), { signal: AbortSignal.timeout(15_000), redirect: "error" });
  const health = await response.json();
  if (!response.ok) throw new Error(`Health check failed with HTTP ${response.status}`);
  if (health.release?.commit !== expectedCommit)
    throw new Error(`Release drift: expected commit ${expectedCommit}, received ${health.release?.commit || "missing"}`);
  if (health.migration !== expectedMigration)
    throw new Error(`Migration drift: expected ${expectedMigration}, received ${health.migration || "missing"}`);
  if (patientUse) {
    const readiness = await request(new URL("/api/ready", base), { signal: AbortSignal.timeout(15_000), redirect: "error" });
    const body = await readiness.json();
    if (!readiness.ok || body.status !== "ready")
      throw new Error("Patient-use verification blocked: production configuration or approval evidence is incomplete. Review Administration readiness with an authorised account.");
  }
  return { commit: expectedCommit, migration: expectedMigration, patientReadinessChecked: patientUse };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyRelease({ origin: process.env.RELEASE_ORIGIN, expectedCommit: process.env.EXPECTED_RELEASE_SHA, expectedMigration: process.env.EXPECTED_MIGRATION, patientUse: process.argv.includes("--patient-use") });
    console.log(JSON.stringify(result));
    if (!result.patientReadinessChecked) console.log("Release identity verified only. Run ops:patient-use-verify before patient-use approval.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release verification failed");
    process.exitCode = 1;
  }
}
