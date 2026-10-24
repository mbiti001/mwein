import { createHash, randomUUID } from "node:crypto";
// Native narrative-history acceptance plus explicitly retained structured-history/replay gaps.
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
    (SELECT json_agg(h ORDER BY h.version) FROM "ServicePointRevision" h WHERE h."encounterId"=$1) AS revisions,
    (SELECT json_agg(a ORDER BY a.sequence) FROM "AuditEvent" a WHERE
      (a.action='SERVICE_POINT_ASSESSMENT_SAVED' AND a."entityId"=$2) OR
      (a.action='ENCOUNTER_ADDENDUM_ADDED' AND a."entityId"=$1::text)) AS audits`, [encounterId, first.body.record.id])).rows[0];
  let current = await snapshot();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert(current.records.length === 1 && current.records[0].id === first.body.record.id && current.records[0].data.carePlan === "Current synthetic plan", "Re-audit history contract: assessment storage behavior changed");
  assert(current.audits.length === 2 && current.revisions.length === 2 && current.revisions[0].data.carePlan === input.data.carePlan && current.revisions[1].data.carePlan === second.body.record.data.carePlan, "Original structured text was not retained across accepted saves");
  steps.push("verify two accepted assessment edits retain original/current structured versions beside one current projection");
  const amend = body => request(`/api/encounters/${encounterId}/addenda`, { method: "POST", body: JSON.stringify(body) });
  const amendment = { idempotencyKey: randomUUID(), reason: "Clarify synthetic assessment", text: "Synthetic narrative amendment for history audit" };
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
  assert(same(amended.records, current.records) && same(amended.revisions, current.revisions) && amended.addenda.length === 1 && amended.addenda[0].text === amendment.text, "Narrative addendum replaced the structured assessment");
  assert(same(amended.audits.slice(0, 2), current.audits), "Narrative addendum changed earlier assessment audits");
  const event = amended.audits[2];
  const persisted = amended.addenda[0];
  const digest = createHash("sha256").update(JSON.stringify(["addendum-v1", visit.facilityId, visit.id, persisted.id, persisted.encounterId, persisted.authorId, persisted.reason, persisted.text, new Date(persisted.createdAt + "Z").toISOString()])).digest("hex");
  const session = event.sessionId && (await pg.query('SELECT "userId" FROM "Session" WHERE id=$1', [event.sessionId])).rows[0];
  assert(event.userId === persisted.authorId && event.facilityId === visit.facilityId && session?.userId === persisted.authorId && event.afterHash === 'addendum-v1:' + digest, "Narrative audit persisted fingerprint or session attribution mismatch");
  assert(added.response.headers.get("cache-control") === "private, no-store", "Narrative POST is not private");
  steps.push("verify narrative persisted-value fingerprint, authenticated session and unchanged assessment/prior audit history");
  const read = await request(`/api/service-points?visitId=${visit.id}`);
  assert(read.response.status === 200 && read.body.readOnly && read.body.record.data.carePlan === "Current synthetic plan", "Signed assessment read changed current data");
  assert(read.body.addenda.items.length === 1 && read.body.addenda.items[0].id === persisted.id && read.body.addenda.items[0].text === amendment.text && read.body.addenda.items[0].author.displayName && read.body.addenda.items[0].encounterId === encounterId && !read.body.addenda.hasMore, "Saved narrative missing from assessment read");
  assert(read.response.headers.get("cache-control") === "private, no-store", "Narrative read is not private");
  const disclosure = (await pg.query(`SELECT * FROM "AuditEvent" WHERE action='SENSITIVE_DATA_ACCESSED' AND reason='SERVICE_POINTS' AND "facilityId"=$1 ORDER BY sequence DESC LIMIT 1`, [visit.facilityId])).rows[0];
  const ids = [visit.id, persisted.id].sort();
  assert(disclosure.afterHash === '2:' + createHash("sha256").update(ids.join("\u001f")).digest("hex") && disclosure.sessionId, "Narrative disclosure did not bind returned identifiers/session");
  for (const [cookie, status] of [[reception.cookie, 403], [foreign.cookie, 404]]) {
    const denied = await requestWithCookie(`/api/service-points?visitId=${visit.id}`, cookie);
    assert(denied.response.status === status && !denied.body.addenda, "Narrative read role/facility denial failed");
  }
  steps.push("verify privately disclosed narrative text, author, encounter and audited identifiers with read role/facility denial");
  await pg.exec(`CREATE FUNCTION e2e_history_read_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='SENSITIVE_DATA_ACCESSED' AND NEW.reason='SERVICE_POINTS' THEN RAISE EXCEPTION 'synthetic history disclosure failure'; END IF;
    RETURN NEW; END; $$; CREATE TRIGGER e2e_history_read_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION e2e_history_read_failure();`);
  try {
    const failed = await request(`/api/service-points?visitId=${visit.id}`);
    assert(failed.response.status === 500 && !failed.body.addenda && !JSON.stringify(failed.body).includes(amendment.text), "Failed disclosure leaked narrative text");
  } finally { await pg.exec('DROP TRIGGER e2e_history_read_failure ON "AuditEvent"; DROP FUNCTION e2e_history_read_failure();'); }
  steps.push("verify native disclosure-audit failure withholds narrative and assessment data");
  const repeated = await amend(amendment);
  assert(repeated.response.status === 200 && repeated.body.replayed && repeated.body.addendum.id === added.body.addendum.id, "Exact retry did not return the committed narrative");
  current = await snapshot();
  assert(current.addenda.length === 1 && current.audits.length === 3 && same(current, amended), "Exact retry changed retained narrative or audit history");
  steps.push("verify exact narrative replay returns original record without another row or success event");
  for (const patch of [{ text: "Changed synthetic narrative" }, { reason: "Changed synthetic reason" }]) {
    assert((await amend({ ...amendment, ...patch })).response.status === 409 && same(await snapshot(), current), "Changed-payload replay mutated saved state");
  }
  const renewed = await authenticate("MMS", "admin@mwein.local");
  const renewedReplay = await requestWithCookie(`/api/encounters/${encounterId}/addenda`, renewed.cookie, { method: "POST", body: JSON.stringify(amendment) });
  assert(renewedReplay.response.status === 200 && renewedReplay.body.addendum.id === persisted.id && same(await snapshot(), current), "Same actor could not confirm after renewed authentication");
  const otherAuthor = await authenticate("MMS", "medical.director@example.test");
  const authorDenied = await requestWithCookie(`/api/encounters/${encounterId}/addenda`, otherAuthor.cookie, { method: "POST", body: JSON.stringify(amendment) });
  assert(authorDenied.response.status === 409 && !authorDenied.body.addendum && same(await snapshot(), current), "Another permitted actor replayed the original key");
  const summaryRead = await request(`/api/visit-summaries?visitId=${visit.id}`);
  assert(summaryRead.response.status === 200 && summaryRead.body.summaries[0].encounter.addenda.some(item => item.id === persisted.id) && !JSON.stringify(summaryRead.body).includes(amendment.idempotencyKey), "Summary disclosed the internal retry key or omitted saved narrative");
  const concurrentInput = { ...amendment, idempotencyKey: randomUUID(), text: "Separate reviewed concurrent synthetic narrative" };
  const concurrent = await Promise.all([amend(concurrentInput), amend(concurrentInput)]);
  assert(concurrent.map(item => item.response.status).sort().join() === "200,201" && concurrent[0].body.addendum.id === concurrent[1].body.addendum.id, "Concurrent identical requests did not converge to one record");
  current = await snapshot();
  assert(current.addenda.length === 2 && current.audits.length === 4 && same(current.records, amended.records) && same(current.revisions, amended.revisions), "Concurrent retries changed projections or duplicated audits");
  steps.push("verify changed narrative rejection, renewed actor session confirmation and concurrent exact-key convergence");
  await pg.query('UPDATE "Encounter" SET status=\'CORRECTED\' WHERE id=$1', [encounterId]);
  const refused = await save({ ...input, expectedRevision: second.body.assessmentRevision });
  assert(refused.response.status === 409 && refused.body.error.includes("addendum"), "Corrected assessment replacement guidance changed");
  assert((await amend(amendment)).response.status === 409 && same(await snapshot(), current), "Re-audit corrected-encounter amendment contract: denial/state changed");
  assert(!refused.body.error.includes("Add an authorised"), "Corrected assessment still suggests an unavailable write");
  steps.push("verify corrected assessment keeps existing write gates without suggesting an unavailable addendum action");
  // Direct SQL creates extra synthetic narratives (not API provenance) to exercise
  // tied timestamp ordering, truncation, and older-encounter inclusion.
  // Derive fixture times from stored rows: fixed calendar dates become older
  // than the API-created encounter and stop testing the intended newer draft.
  await pg.query(`INSERT INTO "EncounterAddendum" (id, "encounterId", "authorId", reason, text, "createdAt") SELECT gen_random_uuid(), $1::uuid, $2::uuid, 'Synthetic limit fixture', 'Synthetic extra narrative ' || n, (SELECT MAX("createdAt") + interval '1 second' FROM "EncounterAddendum" WHERE "encounterId"=$1::uuid) FROM generate_series(1,21) n`, [encounterId, persisted.authorId]);
  const expected = (await pg.query(`SELECT id FROM "EncounterAddendum" WHERE "encounterId"=$1 ORDER BY "createdAt" DESC, id DESC LIMIT 20`, [encounterId])).rows.map(row => row.id);
  await pg.query(`INSERT INTO "Encounter" (id, "visitId", "clinicianId", "noteFormat", status, "createdAt", "updatedAt") SELECT gen_random_uuid(), $1::uuid, $2::uuid, 'STRUCTURED', 'DRAFT', MAX("createdAt") + interval '1 second', MAX("createdAt") + interval '1 second' FROM "Encounter" WHERE "visitId"=$1::uuid`, [visit.id, persisted.authorId]);
  const limited = await request(`/api/service-points?visitId=${visit.id}`);
  assert(limited.response.status === 200 && limited.body.encounterStatus === 'DRAFT' && limited.body.readOnly && limited.body.addenda.hasMore && limited.body.addenda.limit === 20 && same(limited.body.addenda.items.map(item => item.id), expected), "Bounded history lost older encounter or deterministic order");
  steps.push("verify deterministic latest twenty narrative limit and older corrected encounter alongside newer draft");
  await pg.query('UPDATE "QueueEntry" SET status=\'COMPLETED\', "completedAt"=CURRENT_TIMESTAMP WHERE "visitId"=$1 AND status IN (\'WAITING\',\'CALLED\',\'IN_PROGRESS\')', [visit.id]);
  console.log(JSON.stringify({ event: "assessment_history_characterization", visitId: visit.id, encounterId, recordId: first.body.record.id, observedCurrentRows: 1, assessmentSuccessEvents: 2, narrativeRowsAfterIdenticalSubmissions: 1, priorStructuredTextRetainedInQueriedState: true, servicePointReadIncludesAmendment: true, amendmentSessionAttributed: true, correctedAmendmentAccepted: false, permissionFacilityDenial: true, auditFailureRollback: true }));
}
