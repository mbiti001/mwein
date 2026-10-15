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
  "DiagnosticReview",
  "GoodsReceipt",
  "PaymentRequest",
  "ClinicDocument",
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
  "UserMfa",
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
    'AncAdmissionEvidence_immutable',
    'GoodsReceipt_immutable'
  ) ORDER BY tgname`,
);
if (triggerResult.rows.length !== 6)
  throw new Error(`Expected 6 immutable record triggers, found ${triggerResult.rows.length}`);

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

// Document signatures are complete and signed originals remain immutable.
await db.exec(`INSERT INTO "ClinicDocument" ("id", "facilityId", "kind", "reference", "payload", "context", "authorId", "signerRoles", "updatedAt") VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '11111111-1111-4111-8111-111111111111', 'DELIVERY', 'DOCUMENT-SMOKE', '{}', '{}', '22222222-2222-4222-8222-222222222222', ARRAY[]::text[], CURRENT_TIMESTAMP)`);
let incompleteRejected = false;
try { await db.exec(`UPDATE "ClinicDocument" SET "status" = 'SIGNED' WHERE "reference" = 'DOCUMENT-SMOKE'`); } catch { incompleteRejected = true; }
if (!incompleteRejected) throw new Error("Unsigned document could be marked signed");
await db.exec(`UPDATE "ClinicDocument" SET "status" = 'SIGNED', "signedById" = '22222222-2222-4222-8222-222222222222', "signedAt" = CURRENT_TIMESTAMP, "signerName" = 'Synthetic signer', "signerSessionId" = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', "contentHash" = repeat('a',64) WHERE "reference" = 'DOCUMENT-SMOKE'`);
for (const statement of [
  `UPDATE "ClinicDocument" SET "payload" = '{"tampered":true}' WHERE "reference" = 'DOCUMENT-SMOKE'`,
  `UPDATE "ClinicDocument" SET "status" = 'DRAFT' WHERE "reference" = 'DOCUMENT-SMOKE'`,
  `DELETE FROM "ClinicDocument" WHERE "reference" = 'DOCUMENT-SMOKE'`,
]) {
  let rejected = false;
  try { await db.exec(statement); } catch (error) { rejected = String(error).includes("immutable"); }
  if (!rejected) throw new Error("Signed clinic document could be changed");
}

// Delivery evidence cannot be attached to an open/unprepared request. Historical
// completed requests remain valid without fabricated retrospective evidence.
await db.exec(`INSERT INTO "DataSubjectRequest" ("id", "facilityId", "patientId", "type", "details", "dueAt", "createdById", "updatedById", "updatedAt") VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'ACCESS', 'Synthetic rights constraint check', CURRENT_TIMESTAMP, '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', CURRENT_TIMESTAMP)`);
for (const [set, constraint] of [
  [`"responsePreparedAt" = CURRENT_TIMESTAMP`, "DataSubjectRequest_response_pair_check"],
  [`"deliveryEvidence" = '{}'::jsonb`, "DataSubjectRequest_delivery_check"],
  [`"identityVerification" = '{}'::jsonb`, "DataSubjectRequest_identity_evidence_check"],
  [`"identityVerification" = '[]'::jsonb`, "DataSubjectRequest_identity_evidence_check"],
  [`"status" = 'COMPLETED', "completedAt" = CURRENT_TIMESTAMP, "deliveryEvidence" = '[]'::jsonb`, "DataSubjectRequest_delivery_check"],
]) {
  let rejected = false;
  try { await db.exec(`UPDATE "DataSubjectRequest" SET ${set} WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'`); } catch (error) { rejected = String(error).includes(constraint); }
  if (!rejected) throw new Error(`Missing rights evidence constraint: ${constraint}`);
}
await db.exec(`UPDATE "DataSubjectRequest" SET "status" = 'COMPLETED', "completedAt" = CURRENT_TIMESTAMP WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'`);
const rightsIdentity={version:1,requestId:'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',patientId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',facilityId:'11111111-1111-4111-8111-111111111111',requestType:'ACCESS',requestKey:'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',requesterKind:'AUTHORIZED_REPRESENTATIVE',requesterReference:'synthetic-representative',identityEvidenceReference:'synthetic-identity',relationship:'guardian',authorityEvidenceReference:'synthetic-authority',authorizationScope:'PATIENT_RECORD_EXPORT',scopeSummary:'Entire synthetic available patient record',attested:true,verifiedById:'22222222-2222-4222-8222-222222222222',verifiedByName:'Synthetic DPO',verifiedAt:new Date().toISOString()};
for(const invalid of [{...rightsIdentity,patientId:'other'},{...rightsIdentity,authorityEvidenceReference:null},{...rightsIdentity,attested:false}]) {
 let rejected=false;try{await db.query('UPDATE "DataSubjectRequest" SET "identityVerification"=$1::jsonb WHERE id=$2',[JSON.stringify(invalid),rightsIdentity.requestId]);}catch(error){rejected=String(error).includes('identity_evidence_check');}if(!rejected)throw new Error('Invalid identity evidence accepted');
}
await db.query('UPDATE "DataSubjectRequest" SET "identityVerification"=$1::jsonb WHERE id=$2',[JSON.stringify(rightsIdentity),rightsIdentity.requestId]);
for(const statement of [`UPDATE "DataSubjectRequest" SET "identityVerification"=NULL WHERE id=$1`,`UPDATE "DataSubjectRequest" SET "dueAt"=CURRENT_TIMESTAMP+INTERVAL '1 day' WHERE id=$1`,`DELETE FROM "DataSubjectRequest" WHERE id=$1`]) {
 let rejected=false;try{await db.query(statement,[rightsIdentity.requestId]);}catch(error){rejected=String(error).includes('immutable');}if(!rejected)throw new Error('Retained identity evidence or original deadline was mutable');
}

await db.exec(`
  INSERT INTO "ClinicalOrder" ("id", "visitId", "orderedById", "type", "displayName")
  VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'LABORATORY', 'Synthetic review');
  INSERT INTO "DiagnosticReview" ("id", "orderId", "actorId", "sequence", "action", "note", "requestKey", "requestHash")
  VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', '22222222-2222-4222-8222-222222222222', 1, 'CLAIM', 'Synthetic ownership', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 'hash');
`);
for (const statement of [
  `UPDATE "DiagnosticReview" SET "note" = 'tampered'`,
  `DELETE FROM "DiagnosticReview"`,
  `INSERT INTO "DiagnosticReview" ("id", "orderId", "actorId", "sequence", "action", "note", "requestKey", "requestHash") VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', '22222222-2222-4222-8222-222222222222', 2, 'ACKNOWLEDGE', 'Missing report evidence', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5', 'hash')`,
]) {
  let rejected = false;
  try { await db.exec(statement); } catch { rejected = true; }
  if (!rejected) throw new Error("Diagnostic review evidence constraint failed");
}
const acknowledgementInsert = sequence => `INSERT INTO "DiagnosticReview" ("id", "orderId", "actorId", "sequence", "action", "note", "resultId", "verifiedAt", "requestKey", "requestHash") VALUES (gen_random_uuid(), 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', '22222222-2222-4222-8222-222222222222', ${sequence}, 'ACKNOWLEDGE', 'Synthetic review and next steps', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6', CURRENT_TIMESTAMP, gen_random_uuid(), 'hash')`;
await db.exec(acknowledgementInsert(2));
let repeatedAcknowledgementRejected = false;
try { await db.exec(acknowledgementInsert(3)); } catch { repeatedAcknowledgementRejected = true; }
if (!repeatedAcknowledgementRejected) throw new Error("Duplicate diagnostic acknowledgement was accepted");
console.log(`verified ${migrations.length} migrations, ${requiredTables.length} required tables, immutable triggers, stocktake and cashier-shift uniqueness, rights and diagnostic-review evidence constraints, and balanced journal constraints`);
// Draft edits must not change allocated references or durable retry receipts.
await db.exec(`INSERT INTO "ClinicDocument" ("id", "facilityId", "kind", "reference", "payload", "context", "authorId", "signerRoles", "updatedAt", "creationKey", "creationHash") VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '11111111-1111-4111-8111-111111111111', 'DELIVERY', 'TEST-DELIVERY-2026-000001', '{}', '{}', '22222222-2222-4222-8222-222222222222', ARRAY[]::text[], CURRENT_TIMESTAMP, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4', repeat('b',64))`);
for (const statement of [
  `UPDATE "ClinicDocument" SET "reference"='renumbered' WHERE "reference"='TEST-DELIVERY-2026-000001'`,
  `UPDATE "ClinicDocument" SET "creationHash"=repeat('c',64) WHERE "reference"='TEST-DELIVERY-2026-000001'`,
  `UPDATE "ClinicDocument" SET "creationKey"=NULL, "creationHash"=NULL WHERE "reference"='TEST-DELIVERY-2026-000001'`,
]) {
  let rejected = false;
  try { await db.exec(statement); } catch (error) { rejected = String(error).includes("immutable"); }
  if (!rejected) throw new Error("Draft reference or creation receipt could be reassigned");
}
for (const [key, hash, reference] of [
  [`'cccccccc-cccc-4ccc-8ccc-ccccccccccc4'`, `repeat('b',64)`, "TEST-DELIVERY-2026-000002"],
  ["NULL", `repeat('b',64)`, "TEST-DELIVERY-2026-000003"],
  [`'cccccccc-cccc-4ccc-8ccc-ccccccccccc5'`, "NULL", "TEST-DELIVERY-2026-000004"],
  [`'cccccccc-cccc-4ccc-8ccc-ccccccccccc5'`, "'invalid'", "TEST-DELIVERY-2026-000005"],
]) {
  let rejected = false;
  try { await db.exec(`INSERT INTO "ClinicDocument" ("id", "facilityId", "kind", "reference", "payload", "context", "authorId", "signerRoles", "updatedAt", "creationKey", "creationHash") VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc6', '11111111-1111-4111-8111-111111111111', 'DELIVERY', '${reference}', '{}', '{}', '22222222-2222-4222-8222-222222222222', ARRAY[]::text[], CURRENT_TIMESTAMP, ${key}, ${hash})`); } catch { rejected = true; }
  if (!rejected) throw new Error("Duplicate or malformed creation receipt was accepted");
}
console.log("verified immutable document references, receipt pairing and replay-key uniqueness");
await db.close();
