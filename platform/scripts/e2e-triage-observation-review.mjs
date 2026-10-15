import { randomUUID } from "node:crypto";

// Independent regression expectations for existing rules, not new clinical policy.
// Called only by the isolated synthetic database fixture, never production.
export async function verifyTriageObservationReview({ pg, requestWithCookie, sessionCookie, facility, assert, steps }) {
  const baseline = { temperatureC: 37.2, pulseBpm: 84, respiratoryRate: 18, systolicBp: 118, diastolicBp: 76, oxygenSaturation: 98, weightKg: 70, heightCm: 172, painScore: 0, consciousness: "ALERT" };
  const fields = { TEMP: "temperatureC", PULSE: "pulseBpm", RESP_RATE: "respiratoryRate", BP_SYS: "systolicBp", BP_DIA: "diastolicBp", SPO2: "oxygenSaturation", WEIGHT: "weightKg", HEIGHT: "heightCm", PAIN: "painScore", CONSCIOUSNESS: "consciousness" };
  const cases = [
    { name: "normal", changes: {}, abnormal: [], critical: [] },
    { name: "temperature", changes: { temperatureC: 39 }, abnormal: ["TEMP"], critical: [] },
    { name: "pulse", changes: { pulseBpm: 131 }, abnormal: ["PULSE"], critical: [] },
    { name: "respiration", changes: { respiratoryRate: 31 }, abnormal: ["RESP_RATE"], critical: [] },
    { name: "oxygen", changes: { oxygenSaturation: 89 }, abnormal: ["SPO2"], critical: ["SPO2"] },
    { name: "systolic", changes: { systolicBp: 180 }, abnormal: ["BP_SYS"], critical: ["BP_SYS"] },
    { name: "diastolic", changes: { diastolicBp: 120 }, abnormal: ["BP_DIA"], critical: ["BP_DIA"] },
    { name: "pain", changes: { painScore: 7 }, abnormal: ["PAIN"], critical: [] },
    { name: "consciousness", changes: { consciousness: "VOICE" }, abnormal: ["CONSCIOUSNESS"], critical: ["CONSCIOUSNESS"] },
    { name: "mixed", changes: { temperatureC: 39, oxygenSaturation: 89, painScore: 7 }, abnormal: ["TEMP", "SPO2", "PAIN"], critical: ["SPO2"] },
  ];
  for (const scenario of cases) {
    const patientId = randomUUID(), visitId = randomUUID();
    await pg.query(`INSERT INTO "Patient" (id,"facilityId","patientNumber","fullName","normalizedName","sexAtBirth","estimatedAgeYears","updatedAt") VALUES ($1,$2,$3,$4,$4,'MALE',30,now())`, [patientId, facility.id, `E2E-OBS-${scenario.name}`, `Synthetic observation review ${scenario.name}`]);
    await pg.query(`INSERT INTO "Visit" (id,"facilityId","patientId","visitNumber",clinic,"visitType",status,reason,"updatedAt") VALUES ($1,$2,$3,$4,'Outpatient','WALK_IN','AWAITING_TRIAGE','Synthetic observation flags review',now())`, [visitId, facility.id, patientId, `E2E-OBS-${scenario.name}`]);
    await pg.query(`INSERT INTO "QueueEntry" (id,"visitId","servicePoint",priority,status) VALUES ($1,$2,'TRIAGE','ROUTINE','WAITING')`, [randomUUID(), visitId]);
    const input = { ...baseline, ...scenario.changes, requestKey: randomUUID(), chiefComplaint: "Synthetic observation flag regression", triageCategory: "ROUTINE" };
    if (scenario.name === "normal") {
      for (const invalid of [{ painScore: "" }, { painScore: " " }, { painScore: null }, { painScore: false }, { painScore: true }, { painScore: [] }, { painScore: {} }, { painScore: [0] }, { painScore: undefined }, { weightKg: [70] }, { weightKg: true }, { heightCm: null }]) {
        const rejected = await requestWithCookie(`/api/visits/${visitId}/triage`, sessionCookie, { method: "POST", body: JSON.stringify({ ...input, ...invalid }) });
        assert(rejected.response.status === 422, "Non-observation input was accepted by triage");
      }
      const untouched = (await pg.query(`SELECT v.status,(SELECT count(*)::int FROM "TriageRecord" t WHERE t."visitId"=v.id) AS assessments,(SELECT count(*)::int FROM "MeasuredVitals" m WHERE m."visitId"=v.id) AS measurements,(SELECT count(*)::int FROM "QueueEntry" q WHERE q."visitId"=v.id AND q."servicePoint"='CONSULTATION') AS handoffs,(SELECT count(*)::int FROM "QueueEntry" q WHERE q."visitId"=v.id AND q."servicePoint"='TRIAGE' AND q.status='WAITING') AS waiting FROM "Visit" v WHERE v.id=$1`, [visitId])).rows[0];
      assert(untouched.status === "AWAITING_TRIAGE" && untouched.assessments === 0 && untouched.measurements === 0 && untouched.handoffs === 0 && untouched.waiting === 1, "Invalid observation changed clinical records or routing");
      steps.push("reject missing/boolean/non-numeric triage observations without assuming normal pain or writing records");
    }
    const result = await requestWithCookie(`/api/visits/${visitId}/triage`, sessionCookie, { method: "POST", body: JSON.stringify(input) });
    assert(result.response.ok, `Observation ${scenario.name} assessment failed: ${JSON.stringify(result.body)}`);
    const rows = (await pg.query(`SELECT o.code,o."valueDecimal",o."valueText",o.abnormal,o.critical,t."visitId" FROM "Observation" o JOIN "TriageRecord" t ON t.id=o."triageId" WHERE t."visitId"=$1`, [visitId])).rows;
    assert(rows.length === 10, `Observation ${scenario.name} did not persist exactly ten observations`);
    for (const [code, field] of Object.entries(fields)) {
      const matches = rows.filter(row => row.code === code);
      assert(matches.length === 1, `Observation ${scenario.name}/${code} missing or duplicated`);
      const row = matches[0];
      assert(row.visitId === visitId, `Observation ${scenario.name}/${code} attached to wrong visit`);
      assert(code === "CONSCIOUSNESS" ? row.valueText !== null : row.valueDecimal !== null, `Observation ${scenario.name}/${code} stored a null value`);
      assert((code === "CONSCIOUSNESS" ? row.valueText : Number(row.valueDecimal)) === input[field], `Observation ${scenario.name}/${code} value changed`);
      assert(row.abnormal === scenario.abnormal.includes(code), `Observation ${scenario.name}/${code} wrong abnormal flag`);
      assert(row.critical === scenario.critical.includes(code), `Observation ${scenario.name}/${code} wrong critical flag`);
    }
    steps.push(`verify ${scenario.name} triage flags match only their own stored observations without changing other readings`);
  }
}
