// Characterization of CURRENT gaps, not acceptance of a history implementation.
// Invoked only after e2e-database's loopback/dedicated/empty database guards.
export async function verifyAssessmentHistory({ pg, api, request, authenticate, requestWithCookie, assert, steps }) {
  const patient = (await api("register assessment history fixture", "/api/patients", { method: "POST", body: JSON.stringify({ givenName: "Assessment", familyName: "History", dateOfBirth: "1990-02-02", sexAtBirth: "UNKNOWN", phone: "+254700099088", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false }) })).body.patient;
  const visit = (await api("open assessment history fixture", "/api/visits", { method: "POST", body: JSON.stringify({ patientId: patient.id, clinic: "Walk-in", priority: "ROUTINE", visitType: "WALK_IN" }) })).body.visit;
  const input = { action: "SAVE_ASSESSMENT", visitId: visit.id, servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", expectedRevision: null, riskLevel: "ROUTINE", data: { serviceRequested: "Screening", requestDetails: "Synthetic history audit", safetyScreen: "Synthetic checks", carePlan: "Original retained only by test observer" } };
  const save = body => request("/api/service-points", { method: "POST", body: JSON.stringify(body) });
  const first = await save(input);
  assert(first.response.status === 200, "History fixture initial assessment failed");
  const second = await save({ ...input, expectedRevision: first.body.assessmentRevision, data: { ...input.data, carePlan: "Current synthetic plan" } });
  assert(second.response.status === 200, "History fixture reviewed edit failed");
  const encounterId = first.body.record.encounterId;
  const snapshot = async () => (await pg.query(`SELECT
    (SELECT json_agg(r ORDER BY r.id) FROM "ServicePointRecord" r WHERE r."encounterId"=$1) AS records,
    (SELECT json_agg(a ORDER BY a.id) FROM "EncounterAddendum" a WHERE a."encounterId"=$1) AS addenda,
    (SELECT json_agg(a ORDER BY a.sequence) FROM "AuditEvent" a WHERE
      (a.action='SERVICE_POINT_ASSESSMENT_SAVED' AND a."entityId"=$2) OR
      (a.action='ENCOUNTER_ADDENDUM_ADDED' AND a."entityId"=$1::text)) AS audits`, [encounterId, first.body.record.id])).rows[0];
  let current = await snapshot();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert(current.records.length === 1 && current.records[0].id === first.body.record.id && current.records[0].data.carePlan === "Current synthetic plan", "Re-audit history contract: assessment storage behavior changed");
  assert(current.audits.length === 2 && !JSON.stringify(current).includes(input.data.carePlan), "Re-audit history contract: earlier structured content is now retained in queried records/addenda/audit events");
  steps.push("CHARACTERIZATION: two accepted assessment edits retain one current row and hashes, not the prior structured text");
  const amend = body => request(`/api/encounters/${encounterId}/addenda`, { method: "POST", body: JSON.stringify(body) });
  const amendment = { reason: "Clarify synthetic assessment", text: "Synthetic narrative amendment for history audit" };
  assert((await amend(amendment)).response.status === 409, "Draft encounter unexpectedly accepted an addendum");
  assert(same(await snapshot(), current), "Draft rejection changed assessment/history");
  // SQL establishes a synthetic signed state; no clinical signing approval claimed.
  await pg.query('UPDATE "Encounter" SET status=\'SIGNED\', "signedAt"=CURRENT_TIMESTAMP WHERE id=$1', [encounterId]);
  const reception = await authenticate("MMS", "shared.user@example.test");
  const foreign = await authenticate("OTHER", "diagnostic.other@example.test");
  for (const [cookie, status] of [[reception.cookie, 403], [foreign.cookie, 409]]) {
    const denied = await requestWithCookie(`/api/encounters/${encounterId}/addenda`, cookie, { method: "POST", body: JSON.stringify(amendment) });
    assert(denied.response.status === status && !denied.body.addendum, "Amendment permission/facility denial failed");
    assert(same(await snapshot(), current), "Denied amendment changed saved state or audit history");
  }
  steps.push("verify native narrative amendment role/facility denial retains assessment, addenda and success history");
  await pg.exec(`CREATE FUNCTION e2e_history_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='ENCOUNTER_ADDENDUM_ADDED' THEN RAISE EXCEPTION 'synthetic history audit failure' USING ERRCODE='P0001'; END IF;
    RETURN NEW; END; $$; CREATE TRIGGER e2e_history_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION e2e_history_audit_failure();`);
  try {
    const failed = await amend(amendment);
    assert(failed.response.status === 500 && !failed.body.addendum, "Failed amendment audit returned success");
    assert(same(await snapshot(), current), "Failed amendment audit did not roll back the narrative record");
  } finally { await pg.exec('DROP TRIGGER e2e_history_audit_failure ON "AuditEvent"; DROP FUNCTION e2e_history_audit_failure();'); }
  steps.push("verify native narrative amendment audit failure rolls back new text and retains prior success history");
  const added = await amend(amendment);
  assert(added.response.status === 201 && added.body.addendum.author?.displayName, "Signed narrative amendment failed or omitted author display");
  const amended = await snapshot();
  assert(same(amended.records, current.records) && amended.addenda.length === 1 && amended.addenda[0].text === amendment.text, "Narrative addendum replaced the structured assessment");
  assert(same(amended.audits.slice(0, 2), current.audits), "Narrative addendum changed earlier assessment audits");
  const event = amended.audits[2];
  assert(event.userId === added.body.addendum.authorId && event.facilityId === visit.facilityId && event.sessionId === null && event.afterHash === added.body.addendum.id, "Re-audit narrative attribution contract: ID-only/null-session evidence changed");
  steps.push("CHARACTERIZATION: narrative addendum preserves assessment but emits ID-only evidence and no session");
  const read = await request(`/api/service-points?visitId=${visit.id}`);
  assert(read.response.status === 200 && read.body.readOnly && read.body.record.data.carePlan === "Current synthetic plan", "Signed assessment read changed current data");
  assert(!JSON.stringify(read.body).includes(amendment.text) && !Object.hasOwn(read.body, "addenda") && !Object.hasOwn(read.body, "revisions"), "Re-audit service-point reader: history/amendments are now exposed");
  steps.push("CHARACTERIZATION: service-point read omits the persisted narrative amendment and structured history");
  const repeated = await amend(amendment);
  assert(repeated.response.status === 201 && repeated.body.addendum.id !== added.body.addendum.id, "Re-audit amendment replay contract: duplicate prevention changed");
  current = await snapshot();
  assert(current.addenda.length === 2 && current.audits.length === 4 && same(current.records, amended.records), "Repeated narrative submission did not create the characterized two records/events");
  steps.push("CHARACTERIZATION: repeated narrative submissions create distinct records and success events");
  await pg.query('UPDATE "Encounter" SET status=\'CORRECTED\' WHERE id=$1', [encounterId]);
  const refused = await save({ ...input, expectedRevision: second.body.assessmentRevision });
  assert(refused.response.status === 409 && refused.body.error.includes("addendum"), "Corrected assessment replacement guidance changed");
  assert((await amend(amendment)).response.status === 409 && same(await snapshot(), current), "Re-audit corrected-encounter amendment contract: denial/state changed");
  steps.push("CHARACTERIZATION: corrected assessment suggests an addendum but narrative endpoint rejects CORRECTED");
  await pg.query('UPDATE "QueueEntry" SET status=\'COMPLETED\', "completedAt"=CURRENT_TIMESTAMP WHERE "visitId"=$1 AND status IN (\'WAITING\',\'CALLED\',\'IN_PROGRESS\')', [visit.id]);
  console.log(JSON.stringify({ event: "assessment_history_characterization", visitId: visit.id, encounterId, recordId: first.body.record.id, observedCurrentRows: 1, assessmentSuccessEvents: 2, narrativeRowsAfterIdenticalSubmissions: 2, priorStructuredTextRetainedInQueriedState: false, servicePointReadIncludesAmendment: false, amendmentSessionAttributed: false, correctedAmendmentAccepted: false, permissionFacilityDenial: true, auditFailureRollback: true }));
}
