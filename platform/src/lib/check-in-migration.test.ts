import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync("prisma/migrations/20261015090000_check_in_reliability/migration.sql", "utf8");
let database: PGlite;
beforeEach(async () => {
  database = new PGlite();
  await database.exec(`CREATE TABLE "Visit" (
    "id" TEXT PRIMARY KEY, "facilityId" TEXT NOT NULL, "patientId" TEXT NOT NULL,
    "status" TEXT NOT NULL, "clinicallyClosedAt" TIMESTAMP
  )`);
});
afterEach(async () => { await database.close(); });
const insert = (id: string, status = "AWAITING_TRIAGE", facility = "facility-a", closed: Date | null = null) =>
  database.query('INSERT INTO "Visit" VALUES ($1, $2, $3, $4, $5)', [id, facility, "patient-a", status, closed]);

describe("check-in database safeguards", () => {
  it("stops before changing legacy duplicates and retains both care records", async () => {
    await insert("legacy-a"); await insert("legacy-b");
    await expect(database.exec(migration)).rejects.toThrow("review duplicate open visits");
    expect((await database.query('SELECT "id", "status" FROM "Visit" ORDER BY "id"')).rows).toEqual([
      { id: "legacy-a", status: "AWAITING_TRIAGE" }, { id: "legacy-b", status: "AWAITING_TRIAGE" },
    ]);
    expect((await database.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'Visit' AND column_name = 'checkInKey'")).rows).toHaveLength(0);
  });
  it("rejects another active visit at the database boundary, including admitted care", async () => {
    await database.exec(migration); await insert("active", "ADMITTED");
    await expect(insert("duplicate")).rejects.toThrow("Visit_open_patient_key");
    await expect(insert("other-facility", "AWAITING_TRIAGE", "facility-b")).resolves.toBeDefined();
  });
  it("allows new care after clinical closure independently of outstanding payment", async () => {
    await database.exec(migration);
    await insert("unpaid", "AWAITING_PAYMENT", "facility-a", new Date());
    for (const status of ["COMPLETED", "CANCELLED", "DISCHARGED"]) await insert(status, status);
    await expect(insert("new-care")).resolves.toBeDefined();
    await expect(insert("duplicate")).rejects.toThrow("Visit_open_patient_key");
  });
  it("retains facility-scoped replay uniqueness after closure and validates key/fingerprint pairs", async () => {
    await database.exec(migration); await insert("closed", "CANCELLED"); await insert("new-care");
    const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await database.query('UPDATE "Visit" SET "checkInKey"=$1, "checkInFingerprint"=$2 WHERE "id"=$3', [key, "a".repeat(64), "closed"]);
    await expect(database.query('UPDATE "Visit" SET "checkInKey"=$1 WHERE "id"=$2', [key, "new-care"])).rejects.toThrow("Visit_check_in_pair_check");
    await expect(database.query('UPDATE "Visit" SET "checkInKey"=$1, "checkInFingerprint"=$2 WHERE "id"=$3', [key, "a".repeat(64), "new-care"])).rejects.toThrow("Visit_facilityId_checkInKey_key");
    await insert("other-facility", "AWAITING_TRIAGE", "facility-b");
    await expect(database.query('UPDATE "Visit" SET "checkInKey"=$1, "checkInFingerprint"=$2 WHERE "id"=$3', [key, "a".repeat(64), "other-facility"])).resolves.toBeDefined();
  });
});
