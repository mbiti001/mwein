import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = path.join(root, "prisma", "migrations");
const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const db = new PGlite();
await db.waitReady;

for (const migration of migrations) {
  const sql = await readFile(path.join(migrationsRoot, migration, "migration.sql"), "utf8");
  await db.transaction(async (tx) => {
    await tx.exec(sql);
  });
  console.log(`applied ${migration}`);
}

const requiredTables = [
  "MeasuredVitals",
  "SurveillanceRecord",
  "SurveillanceEntry",
  "LocalReportRevision",
  "Facility",
  "Patient",
  "Visit",
  "Encounter",
  "ClinicalOrder",
  "Referral",
  "ReferralAttachment",
  "ReferralAcknowledgement",
  "Stocktake",
  "StocktakeLine",
  "AccountingJournal",
  "AccountingJournalLine",
  "AuditChainHead",
  "LoginThrottle",
  "GovernanceEvidence",
  "PatientProblem",
  "ServicePointControl",
  "ReminderDelivery",
  "MedicationSafetyRule",
  "MedicationSafetyAssessment",
  "ExternalIdentity",
  "IdentityRoleMapping",
  "AiGeneration",
  "CashierShift",
  "OperationsEvidence",
  "AncAdmissionEvidence",
];
const tableResult = await db.query(
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
);
const tables = new Set(tableResult.rows.map((row) => row.tablename));
const missingTables = requiredTables.filter((table) => !tables.has(table));
if (missingTables.length) throw new Error(`Missing migrated tables: ${missingTables.join(", ")}`);

const triggerResult = await db.query(
  `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
    'ReferralAttachment_immutable',
    'ReferralAcknowledgement_immutable',
    'AuditEvent_immutable',
    'MedicationSafetyAssessment_immutable',
    'AncAdmissionEvidence_immutable'
  ) ORDER BY tgname`,
);
if (triggerResult.rows.length !== 5)
  throw new Error(`Expected 5 immutable clinical/audit-record triggers, found ${triggerResult.rows.length}`);

await db.exec(`
  INSERT INTO "Facility" ("id", "code", "name", "updatedAt")
  VALUES ('11111111-1111-4111-8111-111111111111', 'MMS', 'Migration Test Facility', CURRENT_TIMESTAMP);
  INSERT INTO "User" ("id", "facilityId", "email", "displayName", "passwordHash", "updatedAt")
  VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'counter@example.test', 'Migration Counter', 'not-a-real-hash', CURRENT_TIMESTAMP);
  INSERT INTO "Store" ("id", "facilityId", "code", "name")
  VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'MAIN', 'Main pharmacy');
  INSERT INTO "Stocktake" ("id", "facilityId", "storeId", "stocktakeNumber", "openedById")
  VALUES ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'MMS-STK-2026-000001', '22222222-2222-4222-8222-222222222222');
`);

let activeStocktakeConstraintHeld = false;
try {
  await db.exec(`
    INSERT INTO "Stocktake" ("id", "facilityId", "storeId", "stocktakeNumber", "openedById")
    VALUES ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'MMS-STK-2026-000002', '22222222-2222-4222-8222-222222222222');
  `);
} catch (error) {
  activeStocktakeConstraintHeld = String(error).includes("Stocktake_one_active_per_store");
}
if (!activeStocktakeConstraintHeld)
  throw new Error("The one-active-stocktake-per-store constraint did not reject a second open count");

await db.exec(`
  INSERT INTO "CashierShift" ("id", "facilityId", "cashierId", "openingFloat")
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 1000);
`);
let activeCashierShiftConstraintHeld = false;
try {
  await db.exec(`
    INSERT INTO "CashierShift" ("id", "facilityId", "cashierId", "openingFloat")
    VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 500);
  `);
} catch (error) {
  activeCashierShiftConstraintHeld = String(error).includes("CashierShift_cashier_active_key");
}
if (!activeCashierShiftConstraintHeld)
  throw new Error("The one-active-cashier-shift constraint did not reject a second open shift");

await db.exec(`
  INSERT INTO "AuditEvent" (
    "id", "facilityId", "userId", "chainVersion", "sequence", "action", "entityType", "entityId", "previousEventHash", "eventHash"
  ) VALUES (
    '99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 2, 1, 'MIGRATION_SMOKE', 'Migration', 'smoke', 'GENESIS', 'migration-smoke-hash'
  );
`);
let auditImmutabilityHeld = false;
try {
  await db.exec(`UPDATE "AuditEvent" SET "reason" = 'tampered' WHERE "id" = '99999999-9999-4999-8999-999999999999'`);
} catch (error) {
  auditImmutabilityHeld = String(error).includes("immutable");
}
if (!auditImmutabilityHeld) throw new Error("The audit immutability trigger allowed an update");

await db.exec(`
  INSERT INTO "AccountingJournal" ("id", "facilityId", "entryNumber", "sourceType", "sourceId", "description", "postedById")
  VALUES ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'INV-SMOKE', 'MIGRATION_SMOKE', 'smoke-1', 'Balanced-entry smoke test', '22222222-2222-4222-8222-222222222222');
  INSERT INTO "AccountingJournalLine" ("id", "journalId", "accountCode", "accountName", "debit", "credit") VALUES
    ('77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666', '1300', 'Pharmacy inventory', 100, 0),
    ('88888888-8888-4888-8888-888888888888', '66666666-6666-4666-8666-666666666666', '2105', 'Goods received not invoiced', 0, 100);
`);
const balanceResult = await db.query(
  `SELECT SUM("debit")::text AS debit, SUM("credit")::text AS credit
   FROM "AccountingJournalLine" WHERE "journalId" = '66666666-6666-4666-8666-666666666666'`,
);
if (balanceResult.rows[0]?.debit !== balanceResult.rows[0]?.credit)
  throw new Error("Migration smoke journal is not balanced");

// Protect approved reporting snapshots even when writes bypass the application.
await db.exec(`
  INSERT INTO "User" ("id", "facilityId", "email", "displayName", "passwordHash", "updatedAt")
  VALUES ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', 'reviewer@example.test', 'Independent reviewer', 'not-a-real-hash', CURRENT_TIMESTAMP);
  INSERT INTO "LocalReportRevision" ("id", "facilityId", "familyId", "month", "payload", "payloadHash", "preparedById", "contributorIds", "status", "reviewedById", "reviewedAt", "updatedAt")
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', '2026-09', '{}', 'synthetic-hash', '22222222-2222-4222-8222-222222222222', ARRAY['22222222-2222-4222-8222-222222222222']::uuid[], 'APPROVED', '22222222-2222-4222-8222-222222222223', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`);
for (const statement of [
  `UPDATE "LocalReportRevision" SET "payload" = '{"tampered":true}' WHERE "id" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'`,
  `DELETE FROM "LocalReportRevision" WHERE "id" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'`,
]) {
  let rejected = false;
  try { await db.exec(statement); } catch (error) { rejected = String(error).includes("immutable"); }
  if (!rejected) throw new Error("Approved reporting history could be changed");
}

await db.exec(`
  INSERT INTO "SurveillanceRecord" ("id", "facilityId", "details", "updatedAt")
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaadd', '11111111-1111-4111-8111-111111111111', '{}', CURRENT_TIMESTAMP);
  INSERT INTO "SurveillanceEntry" ("id", "recordId", "version", "actorId", "action", "reason", "snapshot", "snapshotHash")
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaade', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaadd', 1, '22222222-2222-4222-8222-222222222222', 'CREATE', 'Synthetic capture', '{}', 'synthetic-hash');
`);
for (const statement of [
  `UPDATE "SurveillanceEntry" SET "reason" = 'tampered' WHERE "id" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaade'`,
  `DELETE FROM "SurveillanceEntry" WHERE "id" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaade'`,
]) {
  let rejected = false;
  try { await db.exec(statement); } catch (error) { rejected = String(error).includes("immutable"); }
  if (!rejected) throw new Error("Surveillance history could be changed");
}

// Measurements remain attributable even when writes bypass the application.
await db.exec(`
  INSERT INTO "Patient" ("id", "facilityId", "patientNumber", "fullName", "normalizedName", "sexAtBirth", "updatedAt")
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '11111111-1111-4111-8111-111111111111', 'VITALS-SMOKE', 'Synthetic Measurement', 'synthetic measurement', 'MALE', CURRENT_TIMESTAMP);
  INSERT INTO "Visit" ("id", "facilityId", "patientId", "visitNumber", "clinic", "visitType", "reason", "updatedAt")
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'VITALS-SMOKE', 'General', 'OUTPATIENT', 'Synthetic verification', CURRENT_TIMESTAMP);
  INSERT INTO "MeasuredVitals" ("id", "visitId", "recordedById", "measuredAt", "values")
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', CURRENT_TIMESTAMP, '{"temperatureC":37}');
`);
for (const statement of [
  `UPDATE "MeasuredVitals" SET "values" = '{}' WHERE "id" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'`,
  `DELETE FROM "MeasuredVitals" WHERE "id" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'`,
]) {
  let rejected = false;
  try { await db.exec(statement); } catch (error) { rejected = String(error).includes("immutable"); }
  if (!rejected) throw new Error("Measured vitals history could be changed");
}

console.log(`verified ${migrations.length} migrations, ${requiredTables.length} required tables, immutable triggers, stocktake and cashier-shift uniqueness, and balanced journal constraints`);
await db.close();
