const origin = process.env.RELEASE_ORIGIN;
const expectedCommit = process.env.EXPECTED_RELEASE_SHA;
const expectedMigration = process.env.EXPECTED_MIGRATION;

if (!origin || !expectedCommit || !expectedMigration) {
  console.error("Set RELEASE_ORIGIN, EXPECTED_RELEASE_SHA and EXPECTED_MIGRATION");
  process.exit(2);
}

const response = await fetch(new URL("/api/health", origin), { signal: AbortSignal.timeout(15_000) });
const health = await response.json();
if (!response.ok) throw new Error(`Health check failed with HTTP ${response.status}`);
if (health.release?.commit !== expectedCommit)
  throw new Error(`Release drift: expected commit ${expectedCommit}, received ${health.release?.commit || "missing"}`);
if (health.migration !== expectedMigration)
  throw new Error(`Migration drift: expected ${expectedMigration}, received ${health.migration || "missing"}`);
console.log(`Verified ${health.release.application} commit ${expectedCommit} at migration ${expectedMigration}`);
