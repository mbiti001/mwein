import { createHash, randomUUID } from "node:crypto";

// Invoked only inside the guarded empty, loopback synthetic workflow fixture.
export async function verifyAssessmentHistoryDisclosure({ pg, request, authenticate, requestWithCookie, assert, steps, visitId, recordId, encounterId }) {
  const path = `/api/service-points/history?visitId=${visitId}&recordId=${recordId}`;
  const initial = await request(path);
  assert(initial.response.status === 200 && initial.body.items.length === 2 && initial.body.items[1].kind === "MIGRATION_BASELINE" && initial.body.items[1].sessionAttribution === "NOT_AVAILABLE" && !JSON.stringify(initial.body).includes('"sessionId"'), "Retained baseline/session availability was misrepresented");
  assert(initial.body.items[0].data.carePlan === "Synthetic reviewed baseline change" && initial.body.items[1].data.carePlan === "Synthetic baseline original", "Retained original/current values were not disclosed");
  assert(initial.response.headers.get("cache-control") === "private, no-store", "History disclosure was cacheable");
  steps.push("verify private structured history returns original baseline and later save with truthful missing session");

  const me = (await request("/api/auth/me")).body.user;
  const persisted = (await pg.query('SELECT * FROM "ServicePointRevision" WHERE "recordId"=$1 ORDER BY version DESC', [recordId])).rows;
  // Prisma stores these timestamp-without-zone values as UTC; avoid the pg
  // driver's host-local interpretation when independently checking the JSON.
  const persistedTime = (await pg.query(`SELECT "sourceUpdatedAt" AT TIME ZONE 'UTC' AS utc FROM "ServicePointRevision" WHERE id=$1`, [persisted[0].id])).rows[0].utc;
  assert(initial.body.items[0].id === persisted[0].id && initial.body.items[0].recordedBy.id === persisted[0].recordedById && initial.body.items[0].sourceUpdatedAt === persistedTime.toISOString(), "History projection differs from retained snapshot");
  const before = JSON.stringify(persisted);
  const disclosure = (await pg.query(`SELECT * FROM "AuditEvent" WHERE action='SENSITIVE_DATA_ACCESSED' AND reason='SERVICE_POINTS' AND "userId"=$1 ORDER BY sequence DESC LIMIT 1`, [me.id])).rows[0];
  const ids = [visitId, recordId, ...initial.body.items.map(row => row.id)].sort();
  const session = (await pg.query('SELECT "userId" FROM "Session" WHERE id=$1', [disclosure.sessionId])).rows[0];
  assert(disclosure.facilityId === me.facilityId && session?.userId === me.id && disclosure.afterHash === ids.length + ':' + createHash("sha256").update(ids.join("\u001f")).digest("hex"), "Structured history disclosure is not bound to returned IDs, authenticated session and facility");
  steps.push("verify native retained values and exact history disclosure fingerprint/session/facility");

  const reception = await authenticate("MMS", "shared.user@example.test");
  const foreign = await authenticate("OTHER", "diagnostic.other@example.test");
  for (const [cookie, status] of [["", 401], [reception.cookie, 403], [foreign.cookie, 404]]) {
    const denied = await requestWithCookie(path, cookie);
    assert(denied.response.status === status && !denied.body.items, "Structured history authentication/permission/facility boundary failed");
  }
  for (const badPath of [path.replace(visitId, randomUUID()), path.replace(recordId, randomUUID()), path + "&beforeVersion=0", path + "&beforeVersion=1&beforeVersion=2"]) {
    const denied = await request(badPath);
    assert([404, 422].includes(denied.response.status) && !denied.body.items, "Foreign identity or malformed history cursor disclosed data");
  }
  steps.push("verify native history authentication/role/facility and mismatched record/visit/cursor denial");

  await pg.exec(`CREATE FUNCTION e2e_structured_disclosure_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='SENSITIVE_DATA_ACCESSED' AND NEW.reason='SERVICE_POINTS' THEN RAISE EXCEPTION 'synthetic structured disclosure failure' USING ERRCODE='P0001'; END IF;
    RETURN NEW; END; $$; CREATE TRIGGER e2e_structured_disclosure_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION e2e_structured_disclosure_failure();`);
  try {
    const failed = await request(path);
    assert(failed.response.status === 500 && !failed.body.items && !JSON.stringify(failed.body).includes("Synthetic baseline original"), "Failed structured disclosure audit exposed saved values");
  } finally { await pg.exec('DROP TRIGGER e2e_structured_disclosure_failure ON "AuditEvent"; DROP FUNCTION e2e_structured_disclosure_failure();'); }
  assert(JSON.stringify((await pg.query('SELECT * FROM "ServicePointRevision" WHERE "recordId"=$1 ORDER BY version DESC', [recordId])).rows) === before, "History reads mutated immutable snapshots");
  steps.push("verify native disclosure failure withholds structured values and all reads preserve original snapshots");

  // Use accepted API saves to populate enough versions for real paging.
  let current = (await request(`/api/service-points?visitId=${visitId}`)).body;
  for (let version = 3; version <= 23; version++) {
    const saved = await request("/api/service-points", { method: "POST", body: JSON.stringify({ action: "SAVE_ASSESSMENT", visitId, expectedRevision: current.assessmentRevision, servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", riskLevel: "ROUTINE", data: { ...current.record.data, carePlan: `Synthetic disclosure version ${version}` } }) });
    assert(saved.response.status === 200 && saved.body.capturedRevision.version === version, `History page fixture save ${version} failed: ${saved.response.status}`);
    current = saved.body;
  }
  const first = await request(path);
  assert(first.response.status === 200 && first.body.items.length === 20 && first.body.items[0].version === 23 && first.body.nextBeforeVersion === 4 && first.body.hasMore, "History first page limit/order/cursor failed");
  const appended = await request("/api/service-points", { method: "POST", body: JSON.stringify({ action: "SAVE_ASSESSMENT", visitId, expectedRevision: current.assessmentRevision, servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", riskLevel: "ROUTINE", data: { ...current.record.data, carePlan: "Synthetic new save between page reads" } }) });
  assert(appended.response.status === 200, "Inter-page fixture append failed");
  const next = await request(path + "&beforeVersion=" + first.body.nextBeforeVersion);
  assert(next.response.status === 200 && JSON.stringify(next.body.items.map(row => row.version)) === "[3,2,1]" && !next.body.hasMore && next.body.nextBeforeVersion === null, "A new save caused paging duplicates or skipped older values");
  const pageAudit = (await pg.query(`SELECT * FROM "AuditEvent" WHERE action='SENSITIVE_DATA_ACCESSED' AND reason='SERVICE_POINTS' AND "userId"=$1 ORDER BY sequence DESC LIMIT 1`, [me.id])).rows[0];
  const pageIds = [visitId, recordId, ...next.body.items.map(row => row.id)].sort();
  assert(pageAudit.afterHash === pageIds.length + ':' + createHash("sha256").update(pageIds.join("\u001f")).digest("hex"), "Older page disclosure fingerprint differs from its returned IDs");
  steps.push("verify native bounded version paging remains stable across new saves and audits each older page");
  for (const status of ["SIGNED", "CORRECTED"]) {
    // SQL state fixture only, not a clinical signing or closure approval.
    await pg.query('UPDATE "Encounter" SET status=$2::"EncounterStatus" WHERE id=$1', [encounterId, status]);
    assert((await request(path)).response.status === 200, "Final encounter state unexpectedly hid authorized history");
  }
  await pg.query('UPDATE "Visit" SET "clinicallyClosedAt"=CURRENT_TIMESTAMP WHERE id=$1', [visitId]);
  assert((await request(path)).response.status === 200, "Clinical closure unexpectedly hid read-only retained history");
  steps.push("verify signed/corrected/closed synthetic states retain authorized read-only history access");
}
