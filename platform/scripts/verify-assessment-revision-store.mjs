// Disposable database only; never accepts DATABASE_URL or resets populated data.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createE2eDatabase, nativeDatabaseConfiguration } from "./e2e-database.mjs";

const fixture = process.env.E2E_TEST_DATABASE_URL === undefined
  ? { kind: "pglite", pg: new PGlite() }
  : await createE2eDatabase();
const db = fixture.pg;
const root = new URL("../prisma/migrations/", import.meta.url);
const target = "20261022010000_assessment_revision_store";
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`); };
const rejected = async (sql, params, code, message) => {
  await assert.rejects(db.query(sql, params), error => (Array.isArray(code) ? code : [code]).includes(error.code), message);
  checks++; console.log(`PASS ${message}`);
};
const ids = Object.fromEntries(["f1", "f2", "u1", "u2", "p1", "p2", "v1", "v2", "e1", "e2", "r1", "r2", "session"].map(k => [k, randomUUID()]));
const role = `history_fixture_${randomUUID().replaceAll("-", "")}`;
try {
  const migrations = (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  assert.ok(migrations.includes(target), "Revision-store migration missing");
  for (const name of migrations.filter(name => name < target)) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), "utf8"));
  for (const n of [1, 2]) {
    await db.query('INSERT INTO "Facility" (id,code,name,"updatedAt") VALUES ($1,$2,$2,now())', [ids[`f${n}`], `HISTORY${n}`]);
    await db.query('INSERT INTO "User" (id,"facilityId",email,"displayName","passwordHash","updatedAt") VALUES ($1,$2,$3,$3,\'synthetic-not-a-password\',now())', [ids[`u${n}`], ids[`f${n}`], `history${n}@example.test`]);
    await db.query('INSERT INTO "Patient" (id,"facilityId","patientNumber","fullName","normalizedName","sexAtBirth","updatedAt") VALUES ($1,$2,$3,$3,$3,\'UNKNOWN\',now())', [ids[`p${n}`], ids[`f${n}`], `Synthetic history ${n}`]);
    await db.query('INSERT INTO "Visit" (id,"facilityId","patientId","visitNumber",clinic,"visitType",reason,"updatedAt") VALUES ($1,$2,$3,$4,\'Walk-in\',\'WALK_IN\',\'Synthetic history\',now())', [ids[`v${n}`], ids[`f${n}`], ids[`p${n}`], `HISTORY-${n}`]);
    await db.query('INSERT INTO "Encounter" (id,"visitId","clinicianId","updatedAt") VALUES ($1,$2,$3,now())', [ids[`e${n}`], ids[`v${n}`], ids[`u${n}`]]);
    await db.query('INSERT INTO "ServicePointRecord" (id,"encounterId","servicePoint","templateVersion",data,"riskLevel","followUpAt","updatedById","createdAt","updatedAt") VALUES ($1,$2,\'WALK_IN\',\'KE-WALKIN-1.0\',$3,$4,$5,$6,\'2026-01-01T10:00:00\',\'2026-02-01T11:00:00\')', [ids[`r${n}`], ids[`e${n}`], JSON.stringify({ carePlan: `Synthetic original ${n} — retained`, missing: "", screened: false }), n === 1 ? "ROUTINE" : null, n === 1 ? "2026-12-01" : null, ids[`u${n}`]]);
  }
  const before = (await db.query('SELECT to_jsonb(r) AS row FROM "ServicePointRecord" r ORDER BY id')).rows;
  const migration = await readFile(new URL(`${target}/migration.sql`, root), "utf8");
  await db.query('UPDATE "ServicePointRecord" SET data=\'[]\' WHERE id=$1', [ids.r2]);
  try { await assert.rejects(db.exec(migration), e => e.code === "23514"); }
  finally { await db.exec('ROLLBACK'); }
  check((await db.query('SELECT to_regclass(\'"ServicePointRevision"\') AS relation')).rows[0].relation === null && Array.isArray((await db.query('SELECT data FROM "ServicePointRecord" WHERE id=$1', [ids.r2])).rows[0].data), "invalid legacy payload aborts complete migration without repairing source data");
  await db.query('UPDATE "ServicePointRecord" SET data=$1 WHERE id=$2', [JSON.stringify(before.find(r => r.row.id === ids.r2).row.data), ids.r2]);
  await db.exec(migration);
  for (const name of migrations.filter(name => name > target)) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), "utf8"));
  const snapshots = () => db.query('SELECT to_jsonb(r) AS row FROM "ServicePointRevision" r ORDER BY "recordId",version');
  const baseline = (await snapshots()).rows;
  check(baseline.length === 2, "populated migration captures exactly one baseline per current record");
  check(JSON.stringify(before) === JSON.stringify((await db.query('SELECT to_jsonb(r) AS row FROM "ServicePointRecord" r ORDER BY id')).rows), "migration preserves current values, timestamps and attribution");
  for (const { row } of baseline) {
    const original = before.find(r => r.row.id === row.recordId).row;
    check(row.kind === "MIGRATION_BASELINE" && row.version === 1 && row.previousVersion === null && row.sessionId === null, "baseline does not invent historical revisions or session evidence");
    check(JSON.stringify(row.data) === JSON.stringify(original.data) && row.recordedById === original.updatedById && row.sourceUpdatedAt === original.updatedAt && row.sourceCreatedAt === original.createdAt && row.followUpAt === original.followUpAt && row.riskLevel === original.riskLevel && row.capturedAt > row.sourceUpdatedAt, "baseline retains typed values, missing fields, source times and separate capture time");
  }
  const first = baseline.find(r => r.row.recordId === ids.r1).row;
  const append = async (overrides = {}) => {
    const row = { ...first, id: randomUUID(), version: 2, previousVersion: 1, kind: "DRAFT_SAVE", sessionId: ids.session, ...overrides };
    const keys = Object.keys(row);
    return db.query(`INSERT INTO "ServicePointRevision" (${keys.map(k => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, keys.map(k => k === "data" ? JSON.stringify(row[k]) : row[k]));
  };
  const fails = async (overrides, code, name) => { await assert.rejects(append(overrides), e => e.code === code, name); checks++; console.log(`PASS ${name}`); };
  await fails({ facilityId: ids.f2 }, "23503", "foreign facility reference rejected");
  await fails({ visitId: ids.v2, facilityId: ids.f2 }, "23503", "foreign visit reference rejected");
  await fails({ encounterId: ids.e2, visitId: ids.v2, facilityId: ids.f2 }, "23503", "foreign encounter reference rejected");
  await fails({ recordId: randomUUID() }, "23503", "nonexistent record reference rejected");
  await fails({ recordedById: randomUUID() }, "23503", "nonexistent recorder rejected");
  await fails({ version: 3, previousVersion: 2 }, "23503", "missing predecessor rejected");
  await fails({ version: 3, previousVersion: 1 }, "23514", "skipped predecessor rejected");
  await fails({ previousVersion: null }, "23514", "null predecessor cannot bypass ordering");
  await fails({ version: 0, previousVersion: null }, "23514", "nonpositive version rejected");
  await fails({ kind: "MIGRATION_BASELINE", sessionId: null }, "23514", "later revision cannot masquerade as migration baseline");
  await fails({ kind: "SIGNED_AMENDMENT" }, "23514", "unreviewed amendment kind rejected");
  await fails({ sessionId: null }, "23514", "future draft revision requires session evidence");
  await fails({ data: [] }, "23514", "non-object structured payload rejected");
  await append();
  check((await snapshots()).rows.length === 3, "valid sequential revision retained alongside original");
  await fails({}, "23505", "duplicate version cannot fork the revision chain");
  await db.exec('BEGIN');
  try {
    await db.query('UPDATE "ServicePointRecord" SET data=\'{"carePlan":"rolled back"}\' WHERE id=$1', [ids.r1]);
    await append({ version: 3, previousVersion: 2 });
    await db.exec("DO $$ BEGIN RAISE EXCEPTION 'synthetic later audit failure'; END $$;");
    assert.fail("synthetic failure did not fire");
  } catch (error) { assert.equal(error.code, "P0001"); }
  finally { await db.exec('ROLLBACK'); }
  check((await snapshots()).rows.length === 3 && JSON.stringify(before) === JSON.stringify((await db.query('SELECT to_jsonb(r) AS row FROM "ServicePointRecord" r ORDER BY id')).rows), "later transaction failure rolls back projection and appended revision");
  // A non-owner, non-superuser app-role analogue. Even excessive DML grants
  // cannot update/delete/truncate; no claim about owners disabling triggers.
  await db.exec(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON "ServicePointRevision" TO "${role}"; SET ROLE "${role}";`);
  try {
    check((await db.query('SELECT count(*)::int AS count FROM "ServicePointRevision"')).rows[0].count === 3, "non-owner fixture role can read granted snapshots");
    await append({ version: 3, previousVersion: 2 });
    check((await snapshots()).rows.length === 4, "non-owner fixture role can append a valid successor");
    await rejected('UPDATE "ServicePointRevision" SET data=\'{}\' WHERE "recordId"=$1', [ids.r1], "55000", "non-owner direct update rejected");
    await rejected('DELETE FROM "ServicePointRevision" WHERE "recordId"=$1', [ids.r1], "55000", "non-owner direct delete rejected");
    await rejected('TRUNCATE "ServicePointRevision"', [], "55000", "non-owner truncate rejected despite explicit privilege");
    await rejected('ALTER TABLE "ServicePointRevision" DISABLE TRIGGER USER', [], "42501", "non-owner cannot disable mutation triggers");
  } finally { await db.exec('RESET ROLE'); }
  // PostgreSQL versions distinguish restrict_violation (23001) from
  // foreign_key_violation (23503); both are integrity errors, never success.
  await rejected('DELETE FROM "ServicePointRecord" WHERE id=$1', [ids.r1], ["23001", "23503"], "parent current record deletion restricted");
  await rejected('DELETE FROM "Encounter" WHERE id=$1', [ids.e1], ["23001", "23503"], "encounter cascade cannot erase retained revisions");
  await rejected('UPDATE "Encounter" SET "visitId"=$1 WHERE id=$2', [ids.v2, ids.e1], ["23001", "23503"], "encounter cannot move retained history into another visit");
  await rejected('UPDATE "Visit" SET "facilityId"=$1 WHERE id=$2', [ids.f2, ids.v1], ["23001", "23503"], "visit cannot move retained history into another facility");
  check((await snapshots()).rows.length === 4, "all rejected mutations preserve original and successor snapshots");
  if (fixture.kind === "native-postgresql") {
    const { Client } = await import("pg");
    const config = nativeDatabaseConfiguration(process.env.E2E_TEST_DATABASE_URL);
    const clients = [new Client(config.clientOptions), new Client(config.clientOptions)];
    try {
      await Promise.all(clients.map(c => c.connect()));
      await Promise.all(clients.map(c => c.query(`SET ROLE "${role}"`)));
      const sql = `INSERT INTO "ServicePointRevision" ("recordId","encounterId","visitId","facilityId",version,"previousVersion",kind,"servicePoint","templateVersion",data,"recordedById","sessionId","sourceCreatedAt","sourceUpdatedAt") SELECT "recordId","encounterId","visitId","facilityId",4,3,'DRAFT_SAVE',"servicePoint","templateVersion",data,"recordedById","sessionId","sourceCreatedAt","sourceUpdatedAt" FROM "ServicePointRevision" WHERE "recordId"=$1 AND version=3`;
      const result = await Promise.allSettled(clients.map(c => c.query(sql, [ids.r1])));
      check(result.filter(r => r.status === "fulfilled").length === 1 && result.filter(r => r.status === "rejected" && r.reason.code === "23505").length === 1 && (await snapshots()).rows.length === 5, "native competing non-owner appends retain exactly one next version without retry");
    } finally { await Promise.all(clients.map(c => c.end())); }
  }
  console.log(`Assessment revision store: ${checks} checks passed; ${migrations.length} migrations; backend ${fixture.kind}`);
} finally {
  try { await db.exec(`RESET ROLE; DROP OWNED BY "${role}"; DROP ROLE "${role}";`); } catch { /* Role may not yet exist on earlier failure. */ }
  await (fixture.close ? fixture.close() : db.close());
}
