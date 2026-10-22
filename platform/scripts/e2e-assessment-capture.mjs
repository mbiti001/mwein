// Guarded disposable fixture only: SQL represents an existing migration baseline,
// not an authorized clinical record repair or a production migration.
import { randomUUID } from "node:crypto";

export async function verifyAssessmentCapture({ pg, api, request, assert, steps }) {
  const patient = (await api("register assessment capture baseline fixture", "/api/patients", { method: "POST", body: JSON.stringify({ givenName: "Capture", familyName: "Baseline", dateOfBirth: "1990-02-02", sexAtBirth: "UNKNOWN", phone: "+254700099088", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false }) })).body.patient;
  const visit = (await api("open assessment capture baseline fixture", "/api/visits", { method: "POST", body: JSON.stringify({ patientId: patient.id, clinic: "Walk-in", priority: "ROUTINE", visitType: "WALK_IN" }) })).body.visit;
  const user = (await request("/api/auth/me")).body.user;
  const encounterId = randomUUID(), recordId = randomUUID();
  const data = { serviceRequested: "Screening", requestDetails: "Synthetic preexisting assessment", safetyScreen: "Synthetic checks", carePlan: "Synthetic baseline original" };
  await pg.query('INSERT INTO "Encounter" (id,"visitId","clinicianId","updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP)', [encounterId, visit.id, user.id]);
  await pg.query('INSERT INTO "ServicePointRecord" (id,"encounterId","servicePoint","templateVersion",data,"riskLevel","updatedById","updatedAt") VALUES ($1,$2,\'WALK_IN\',\'KE-WALKIN-1.0\',$3,\'ROUTINE\',$4,CURRENT_TIMESTAMP)', [recordId, encounterId, JSON.stringify(data), user.id]);
  const snapshot = async () => (await pg.query(`SELECT row_to_json(v) AS visit,
    (SELECT row_to_json(e) FROM "Encounter" e WHERE id=$2) AS encounter,
    (SELECT row_to_json(r) FROM "ServicePointRecord" r WHERE id=$3) AS record,
    (SELECT json_agg(h ORDER BY version) FROM "ServicePointRevision" h WHERE "recordId"=$3) AS revisions,
    (SELECT json_agg(a ORDER BY sequence) FROM "AuditEvent" a WHERE action='SERVICE_POINT_ASSESSMENT_SAVED' AND "entityId"=$3::text) AS audits
    FROM "Visit" v WHERE id=$1`, [visit.id, encounterId, recordId])).rows[0];
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const revision = (await request(`/api/service-points?visitId=${visit.id}`)).body.assessmentRevision;
  const body = { action: "SAVE_ASSESSMENT", visitId: visit.id, expectedRevision: revision, servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", riskLevel: "HIGH", data: { ...data, carePlan: "Synthetic reviewed baseline change" } };
  const save = () => request("/api/service-points", { method: "POST", body: JSON.stringify(body) });
  const missing = await snapshot();
  const refused = await save();
  assert(refused.response.status === 409 && refused.body.details?.code === "ASSESSMENT_HISTORY_INCONSISTENT" && !refused.body.record && same(await snapshot(), missing), "Current assessment without retained history was silently overwritten or given a fabricated baseline");
  steps.push("verify missing capture history refuses save and preserves current values without synthetic baseline repair");
  await pg.query(`INSERT INTO "ServicePointRevision" ("recordId","encounterId","visitId","facilityId",version,kind,"servicePoint","templateVersion",data,"riskLevel","followUpAt","recordedById","sourceCreatedAt","sourceUpdatedAt")
    SELECT r.id,r."encounterId",e."visitId",v."facilityId",1,'MIGRATION_BASELINE',r."servicePoint",r."templateVersion",r.data,r."riskLevel",r."followUpAt",r."updatedById",r."createdAt",r."updatedAt"
    FROM "ServicePointRecord" r JOIN "Encounter" e ON e.id=r."encounterId" JOIN "Visit" v ON v.id=e."visitId" WHERE r.id=$1`, [recordId]);
  const baseline = await snapshot();
  const changed = await save();
  const after = await snapshot();
  assert(changed.response.status === 200, `Reviewed baseline save failed: ${changed.response.status} ${changed.body.details?.code || changed.body.error || "unknown"}`);
  assert(changed.body.capturedRevision.version === 2 && after.revisions.length === 2 && same(after.revisions[0], baseline.revisions[0]), "First reviewed baseline edit lost or rewrote the baseline");
  const current = after.revisions[1];
  assert(after.revisions[0].sessionId === null && after.revisions[0].kind === "MIGRATION_BASELINE" && after.revisions[0].data.carePlan === data.carePlan && current.kind === "DRAFT_SAVE" && current.previousVersion === 1 && current.recordedById === user.id && current.data.carePlan === body.data.carePlan && current.riskLevel === "HIGH", "Baseline and authenticated new snapshot were conflated");
  assert(after.audits.length === 1 && after.audits[0].sessionId === current.sessionId && after.audits[0].reason === `Structured assessment revision 2: ${current.id}` && after.audits[0].entityId === recordId, "Reviewed baseline edit is not bound to its success event");
  steps.push("verify existing migration baseline extends atomically to authenticated version two with unchanged original and bound success audit");
  assert((await save()).response.status === 409 && same(await snapshot(), after), "Replayed baseline edit appended a duplicate revision");
  steps.push("verify original baseline revision replay cannot create duplicate captured history");
  await pg.query('UPDATE "QueueEntry" SET status=\'COMPLETED\', "completedAt"=CURRENT_TIMESTAMP WHERE "visitId"=$1 AND status IN (\'WAITING\',\'CALLED\',\'IN_PROGRESS\')', [visit.id]);
  return { visitId: visit.id, recordId, encounterId };
}
