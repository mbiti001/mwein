import { randomUUID } from "node:crypto";

// Called only from the isolated synthetic PGlite fixture. Never run against production.
export async function verifyTriageReleaseReview({ pg, requestWithCookie, sessionCookie, facility, assert, steps }) {
  const values = { temperatureC: 37.2, pulseBpm: 84, respiratoryRate: 18, systolicBp: 118, diastolicBp: 76, oxygenSaturation: 98, weightKg: 70, heightCm: 172 };
  const input = () => ({ ...values, requestKey: randomUUID(), chiefComplaint: "Independent synthetic triage release review", painScore: 0, consciousness: "ALERT", triageCategory: "ROUTINE" });
  async function visit(suffix) {
    const id = randomUUID(), patientId = randomUUID();
    await pg.query(`INSERT INTO "Patient" (id,"facilityId","patientNumber","fullName","normalizedName","sexAtBirth","estimatedAgeYears","updatedAt") VALUES ($1,$2,$3,$4,$4,'MALE',30,now())`, [patientId, facility.id, `E2E-TRIAGE-PATIENT-${suffix}`, `Synthetic triage review ${suffix}`]);
    await pg.query(`INSERT INTO "Visit" (id,"facilityId","patientId","visitNumber",clinic,"visitType",status,reason,"updatedAt") VALUES ($1,$2,$3,$4,'Outpatient','WALK_IN','AWAITING_TRIAGE','Synthetic triage review',now())`, [id, facility.id, patientId, `E2E-TRIAGE-REVIEW-${suffix}`]);
    await pg.query(`INSERT INTO "QueueEntry" (id,"visitId","servicePoint",priority,status) VALUES ($1,$2,'TRIAGE','ROUTINE','WAITING')`, [randomUUID(), id]);
    return id;
  }
  const submit = (id, body) => requestWithCookie(`/api/visits/${id}/triage`, sessionCookie, { method: "POST", body: JSON.stringify(body) });
  const state = async id => (await pg.query(`SELECT v.status,(SELECT count(*)::int FROM "MeasuredVitals" m WHERE m."visitId"=v.id) AS measurements,(SELECT count(*)::int FROM "TriageRecord" t WHERE t."visitId"=v.id) AS assessments,(SELECT count(*)::int FROM "QueueEntry" q WHERE q."visitId"=v.id AND q."servicePoint"='CONSULTATION') AS consultation,(SELECT count(*)::int FROM "QueueEntry" q WHERE q."visitId"=v.id AND q."servicePoint"='TRIAGE' AND q.status='WAITING') AS waiting FROM "Visit" v WHERE v.id=$1`, [id])).rows[0];

  const fresh = await visit("NEW"), body = input();
  await pg.exec(`CREATE FUNCTION reject_triage_release_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='TRIAGE_COMPLETED' THEN RAISE EXCEPTION 'synthetic triage audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_triage_release_review_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_triage_release_review_audit();`);
  try { assert((await submit(fresh, body)).response.status === 500, "Triage reported success without retained audit"); }
  finally { await pg.exec('DROP TRIGGER reject_triage_release_review_audit ON "AuditEvent"; DROP FUNCTION reject_triage_release_review_audit();'); }
  const rolledBack = await state(fresh);
  assert(rolledBack.status === "AWAITING_TRIAGE" && rolledBack.measurements === 0 && rolledBack.assessments === 0 && rolledBack.consultation === 0 && rolledBack.waiting === 1, "Audit failure did not roll back measurements, assessment and queues together");
  const duplicate = await Promise.all([submit(fresh, body), submit(fresh, body)]);
  assert(duplicate.every(result => result.response.ok), `Concurrent exact triage retries failed: ${JSON.stringify(duplicate.map(result => result.body))}`);
  const saved = await state(fresh);
  assert(saved.status === "AWAITING_CLINICIAN" && saved.measurements === 1 && saved.assessments === 1 && saved.consultation === 1 && saved.waiting === 0, "Concurrent triage duplicated measurements, assessment or handoff");
  assert((await submit(fresh, { ...body, chiefComplaint: "Changed request" })).response.status === 409, "Triage retry accepted changed clinical content");
  steps.push("verify triage audit failure rolls back shared readings and simultaneous retries retain one assessment/handoff");

  for (const scenario of [{ suffix: "PAIN-FLAGS", patch: { painScore: 8 }, abnormal: ["PAIN"], critical: [] }, { suffix: "MIXED-FLAGS", patch: { temperatureC: 39, oxygenSaturation: 88, painScore: 8 }, abnormal: ["PAIN", "SPO2", "TEMP"], critical: ["SPO2"] }]) {
    const id = await visit(scenario.suffix), assessment = { ...input(), ...scenario.patch };
    const response = await submit(id, assessment);
    assert(response.response.ok, "Mixed observation assessment did not save");
    const observations = (await pg.query('SELECT o.code,o.abnormal,o.critical FROM "Observation" o JOIN "TriageRecord" t ON t.id=o."triageId" WHERE t."visitId"=$1 ORDER BY o.code', [id])).rows;
    assert(observations.length === 10, "Missing persisted triage observations");
    assert(JSON.stringify(observations.filter(row => row.abnormal).map(row => row.code)) === JSON.stringify(scenario.abnormal), "Unrelated observations were flagged abnormal");
    assert(JSON.stringify(observations.filter(row => row.critical).map(row => row.code)) === JSON.stringify(scenario.critical), "Persisted critical flags do not match affected readings");
    assert((await state(id)).consultation === 1, "Flag review changed consultation handoff count");
    steps.push("verify persisted field-specific triage flags: " + scenario.suffix);
  }

  for (const partial of [false, true]) {
    const id = await visit(partial ? "PARTIAL" : "COMPLETE");
    const measuredAt = "2026-01-01T07:00:00.000Z";
    const initialValues = partial ? { temperatureC: 37.2, pulseBpm: 84 } : values;
    const measurementRequest = { requestKey: randomUUID(), measuredAt, values: initialValues };
    const measurementPath = `/api/visits/${id}/vitals`;
    const captures = await Promise.all([0,1].map(() => requestWithCookie(measurementPath, sessionCookie, { method: "POST", body: JSON.stringify(measurementRequest) })));
    assert(captures.every(result => result.response.ok), "Concurrent measurement retry failed");
    const source = captures[0].body.measurement;
    assert(source.id === captures[1].body.measurement.id && (await state(id)).measurements === 1, "Measurement retry created duplicate readings");
    const before = (await pg.query('SELECT values,"recordedById","measuredAt" FROM "MeasuredVitals" WHERE id=$1', [source.id])).rows[0];
    const assessment = { ...input(), reviewedVitalsId: source.id, measuredAt: "2026-01-01T07:30:00.000Z" };
    const results = await Promise.all([submit(id, assessment), submit(id, assessment)]);
    assert(results.every(result => result.response.ok), "Reused measurement triage did not survive exact retry");
    const after = await state(id);
    assert(after.measurements === (partial ? 2 : 1) && after.assessments === 1 && after.consultation === 1, "Saved-set reuse or partial completion duplicated records");
    const unchanged = (await pg.query('SELECT values,"recordedById","measuredAt" FROM "MeasuredVitals" WHERE id=$1', [source.id])).rows[0];
    assert(JSON.stringify(before) === JSON.stringify(unchanged), "Completing triage overwrote the original measurement set");
    const retained = (await pg.query(`SELECT m.id,m.values,m.note,m."measuredAt",m."recordedById",m."visitId",v."facilityId",(EXTRACT(EPOCH FROM m."measuredAt") * 1000)::double precision AS "measuredAtMs" FROM "TriageRecord" t JOIN "MeasuredVitals" m ON m.id=t."reviewedVitalsId" JOIN "Visit" v ON v.id=m."visitId" WHERE t."visitId"=$1`, [id])).rows[0];
    for (const [key, value] of Object.entries(values)) assert(retained.values[key] === value, `Reused/completed set lost ${key}`);
    assert(retained.visitId === id && retained.facilityId === facility.id, "Completed measurements have incorrect visit/facility ownership");
    assert(retained.recordedById === before.recordedById, "Synthetic same-actor completion lost recorder attribution");
    assert(Number(retained.measuredAtMs) === Date.parse(partial ? assessment.measuredAt : measuredAt), `Completed/reused measurement time is incorrect: ${JSON.stringify({ raw: retained.measuredAt, epoch: retained.measuredAtMs, expected: partial ? assessment.measuredAt : measuredAt })}`);
    assert(partial ? retained.id !== source.id : retained.id === source.id, "Assessment measurement reference does not match reuse/completion behavior");
    if (partial) {
      assert(retained.note.includes(source.id) && retained.note.includes(measuredAt), "Partial completion lost source identity/time");
      const audit = (await pg.query(`SELECT reason FROM "AuditEvent" WHERE action='VITALS_MEASURED' AND "entityId"=$1`, [retained.id])).rows[0];
      assert(JSON.parse(audit.reason).completedFrom === source.id, "Partial completion has no durable source reference");
    }
    steps.push(`verify ${partial ? "partial measurements completed with retained source provenance" : "complete saved measurements reused without an extra set"} and exact concurrent retries`);
  }
}
