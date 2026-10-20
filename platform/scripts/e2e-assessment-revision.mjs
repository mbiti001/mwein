// Guarded synthetic fixture only. Lifecycle race writers below establish SQL
// test states; they are not clinical sign/discharge workflows or approvals.
import { createHash } from "node:crypto";
export async function verifyAssessmentRevision({ pg, databaseKind, api, request, assert, steps }) {
  const patient = (await api("register assessment revision fixture", "/api/patients", { method: "POST", body: JSON.stringify({ givenName: "Assessment", familyName: "Revision", dateOfBirth: "1990-02-02", sexAtBirth: "UNKNOWN", phone: "+254700099099", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false }) })).body.patient;
  const visit = (await api("open assessment revision fixture", "/api/visits", { method: "POST", body: JSON.stringify({ patientId: patient.id, clinic: "Walk-in", priority: "ROUTINE", visitType: "WALK_IN" }) })).body.visit;
  const input = { action: "SAVE_ASSESSMENT", visitId: visit.id, servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", expectedRevision: null, riskLevel: "ROUTINE", data: { serviceRequested: "Screening", requestDetails: "Synthetic revision checks", safetyScreen: "Synthetic checks", carePlan: "First synthetic plan" } };
  const save = body => request("/api/service-points", { method: "POST", body: JSON.stringify(body) });
  const read = () => request(`/api/service-points?visitId=${visit.id}`);
  const snapshot = async () => (await pg.query(`SELECT row_to_json(v) AS visit,
    (SELECT json_agg(e ORDER BY e.id) FROM "Encounter" e WHERE e."visitId"=v.id) AS encounters,
    (SELECT json_agg(r ORDER BY r.id) FROM "ServicePointRecord" r JOIN "Encounter" e ON e.id=r."encounterId" WHERE e."visitId"=v.id) AS records,
    (SELECT json_agg(q ORDER BY q.id) FROM "QueueEntry" q WHERE q."visitId"=v.id) AS queues,
    (SELECT json_agg(a ORDER BY a.sequence) FROM "AuditEvent" a WHERE a.action='SERVICE_POINT_ASSESSMENT_SAVED' AND a."entityId" IN
      (SELECT r.id::text FROM "ServicePointRecord" r JOIN "Encounter" e ON e.id=r."encounterId" WHERE e."visitId"=v.id)) AS audits
    FROM "Visit" v WHERE v.id=$1`, [visit.id])).rows[0];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const waitForWriters = async count => {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      await pg.query("SELECT pg_stat_clear_snapshot()");
      const waiting = await pg.query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
        AND wait_event_type='Lock' AND query LIKE '%UPDATE%Visit%'`);
      if (waiting.rows[0].count >= count) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Assessment race did not observe ${count} blocked visit writers`);
  };
  let first;
  assert((await read()).body.assessmentRevision === null, "First assessment read did not return an explicit null revision");
  if (databaseKind === "native-postgresql") {
    await pg.exec("BEGIN");
    const pending = [];
    try {
      await pg.query('SELECT id FROM "Visit" WHERE id=$1 FOR UPDATE', [visit.id]);
      pending.push(save(input), save({ ...input, data: { ...input.data, carePlan: "Other concurrent first plan" } }));
      await waitForWriters(2);
      await pg.exec("COMMIT");
      const results = await Promise.all(pending);
      assert(results.map(r => r.response.status).sort().join(",") === "200,409", "Concurrent first assessment saves did not yield one success and one conflict");
      first = results.find(r => r.response.status === 200);
    } catch (error) { await pg.exec("ROLLBACK"); await Promise.allSettled(pending); throw error; }
    steps.push("verify native overlapping first assessment saves yield one encounter, record and success audit");
  } else {
    first = await save(input);
    assert((await save(input)).response.status === 409, "Sequential first-save revision was reused");
    steps.push("verify sequential first assessment revision rejection (PGlite; no concurrent-writer claim)");
  }
  const initial = await snapshot();
  assert(first.response.status === 200 && initial.encounters.length === 1 && initial.records.length === 1 && initial.audits.length === 1, "First assessment had duplicate or missing durable effects");
  assert(initial.records[0].id === first.body.record.id && initial.audits[0].userId === first.body.record.updatedById && initial.audits[0].facilityId === visit.facilityId, "First assessment success attribution mismatch");
  // Independently reconstruct the documented v1 format from PostgreSQL rows.
  // This fixture uses flat data, whose JSONB key order may differ from the POST.
  // Prisma DateTime uses UTC in timestamp-without-timezone columns. Raw
  // row_to_json text has no offset; do not reinterpret it in the test host zone.
  const sqlUtc = value => new Date(value.length === 10 ? `${value}T00:00:00Z` : `${value}Z`).toISOString();
  const fingerprint = record => `assessment-v1:${createHash("sha256").update(JSON.stringify([
    "assessment-v1", visit.facilityId, visit.id,
    record ? [record.id, record.encounterId, record.servicePoint, record.templateVersion,
      Object.fromEntries(Object.entries(record.data).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
      record.riskLevel, record.followUpAt ? sqlUtc(record.followUpAt) : null,
      record.updatedById, sqlUtc(record.updatedAt)] : null,
  ])).digest("hex")}`;
  const firstAudit = initial.audits[0];
  assert(firstAudit.beforeHash === fingerprint(null) && firstAudit.afterHash === fingerprint(initial.records[0]), "First saved assessment fingerprints do not match persisted state");
  const session = firstAudit.sessionId && (await pg.query('SELECT "userId" FROM "Session" WHERE id=$1', [firstAudit.sessionId])).rows[0];
  assert(session?.userId === firstAudit.userId, "Assessment audit omitted or misattributed authenticated session");
  steps.push("verify persisted assessment create fingerprints and authenticated user/session/facility attribution");
  const signerRevision = `${initial.encounters[0].id}:${sqlUtc(initial.encounters[0].updatedAt)}`;
  const original = first.body.assessmentRevision;
  assert((await read()).body.assessmentRevision === original, "Saved revision differs from next read");
  const second = await save({ ...input, expectedRevision: original, data: { ...input.data, carePlan: "Newer synthetic plan" } });
  assert(second.response.status === 200 && second.body.assessmentRevision !== original, "Reviewed edit did not advance assessment revision");
  const after = await snapshot();
  assert(after.audits.length === 2 && same(after.audits[0], firstAudit), "Assessment update rewrote the earlier success audit");
  const secondAudit = after.audits[1];
  assert(secondAudit.beforeHash === firstAudit.afterHash && secondAudit.afterHash === fingerprint(after.records[0]) && secondAudit.afterHash !== firstAudit.afterHash, "Assessment update omitted canonical before/after persisted values");
  assert(secondAudit.sessionId === firstAudit.sessionId && secondAudit.userId === firstAudit.userId && secondAudit.facilityId === visit.facilityId, "Assessment update lost actor/session/facility attribution");
  steps.push("verify persisted assessment update fingerprints link previous state without rewriting earlier audit history");
  assert(new Date(after.encounters[0].updatedAt) > new Date(initial.encounters[0].updatedAt), "Assessment did not invalidate consultation signer revision");
  for (const body of [input, { ...input, expectedRevision: original }, { ...input, expectedRevision: original, data: second.body.record.data }]) {
    assert((await save(body)).response.status === 409, "Stale assessment revision replaced the current record");
    assert(same(await snapshot(), after), "Stale assessment rejection changed visit, record, queue or audit history");
  }
  const staleSign = await request(`/api/visits/${visit.id}/consultation`, { method: "POST", body: JSON.stringify({ action: "SIGN", expectedRevision: signerRevision, data: { disposition: "OUTPATIENT" } }) });
  assert(staleSign.response.status === 409 && staleSign.body.details?.code === "CONSULTATION_REVISION_CONFLICT", "Stale signer did not reject the changed assessment revision");
  assert(same(await snapshot(), after), "Stale signing changed saved state");
  steps.push("verify native stale assessment editors, unchanged-payload replay and stale consultation signing retain current state");
  const currentInput = { ...input, expectedRevision: second.body.assessmentRevision };
  await pg.exec(`CREATE FUNCTION e2e_revision_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='SERVICE_POINT_ASSESSMENT_SAVED' THEN RAISE EXCEPTION 'synthetic revision audit failure' USING ERRCODE='P0001'; END IF;
    RETURN NEW; END; $$; CREATE TRIGGER e2e_revision_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION e2e_revision_audit_failure();`);
  try {
    assert((await save(currentInput)).response.status === 500, "Revision audit failure returned success");
    assert(same(await snapshot(), after), "Audit failure advanced the encounter/visit revision or saved assessment");
  } finally { await pg.exec('DROP TRIGGER e2e_revision_audit_failure ON "AuditEvent"; DROP FUNCTION e2e_revision_audit_failure();'); }
  steps.push("verify assessment update audit failure rolls back encounter revision, visit, record, queue and success history");
  if (databaseKind === "native-postgresql") {
    for (const lifecycle of ["SIGNED", "CLOSED_TIMESTAMP"]) {
      await pg.exec("BEGIN");
      let pending;
      try {
        await pg.query('SELECT id FROM "Visit" WHERE id=$1 FOR UPDATE', [visit.id]);
        pending = save(currentInput);
        await waitForWriters(1);
        if (lifecycle === "SIGNED") {
          await pg.query('UPDATE "Encounter" SET status=\'SIGNED\', "signedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP WHERE id=$1', [after.encounters[0].id]);
          await pg.query('UPDATE "Visit" SET "updatedAt"=CURRENT_TIMESTAMP WHERE id=$1', [visit.id]);
        } else await pg.query('UPDATE "Visit" SET "clinicallyClosedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP WHERE id=$1', [visit.id]);
        await pg.exec("COMMIT");
        assert((await pending).response.status === 409, `Assessment saved across concurrent SQL ${lifecycle}`);
        const current = await snapshot();
        assert(same(current.records, after.records) && same(current.queues, after.queues) && same(current.audits, after.audits), `Concurrent ${lifecycle} changed assessment or success history`);
        steps.push(`verify observed native assessment writer rejects concurrent SQL ${lifecycle} without record or audit effects`);
      } catch (error) { await pg.exec("ROLLBACK"); if (pending) await pending; throw error; }
      // Synthetic-only reset after each asserted rejection, for the next race.
      await pg.query('UPDATE "Encounter" SET status=\'DRAFT\', "signedAt"=NULL, "updatedAt"=$1 WHERE id=$2', [after.encounters[0].updatedAt, after.encounters[0].id]);
      await pg.query('UPDATE "Visit" SET "clinicallyClosedAt"=NULL WHERE id=$1', [visit.id]);
    }
  }
  await pg.query('UPDATE "QueueEntry" SET status=\'COMPLETED\', "completedAt"=CURRENT_TIMESTAMP WHERE "visitId"=$1 AND status IN (\'WAITING\',\'CALLED\',\'IN_PROGRESS\')', [visit.id]);
  console.log(JSON.stringify({ event: "assessment_revision_evidence", databaseKind, canonicalPersistedFingerprints: true, sessionAttribution: true, priorAuditUnchanged: true, overlappingFirstSave: databaseKind === "native-postgresql", staleSignerRejected: true, auditRollback: true, sqlLifecycleRaces: databaseKind === "native-postgresql" ? ["SIGNED", "CLOSED_TIMESTAMP"] : [], visitId: visit.id, encounterId: after.encounters[0].id, recordId: after.records[0].id }));
}
