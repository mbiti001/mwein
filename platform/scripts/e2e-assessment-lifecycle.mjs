// Runs inside the guarded disposable database only. SQL establishes lifecycle
// fixtures; these checks do not claim that a clinical sign/discharge was approved.
export async function verifyAssessmentLifecycle({ pg, api, request, authenticate, requestWithCookie, relatedPatientId, assert, steps }) {
  const reception = await authenticate("MMS", "shared.user@example.test");
  const foreignClinician = await authenticate("OTHER", "diagnostic.other@example.test");
  const data = { serviceRequested: "Screening", requestDetails: "Synthetic lifecycle request", safetyScreen: "Synthetic checks", carePlan: "Retained synthetic plan" };
  for (const [index, lifecycle] of ["SIGNED", "CORRECTED", "DISCHARGED", "CLOSED_TIMESTAMP"].entries()) {
    const patient = (await api(`register assessment lifecycle fixture ${lifecycle}`, "/api/patients", {
      method: "POST", body: JSON.stringify({ givenName: "Assessment", familyName: `Lifecycle ${lifecycle}`, dateOfBirth: "1990-02-02", sexAtBirth: "UNKNOWN", phone: `+25470009900${index}`, county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false }),
    })).body.patient;
    const visit = (await api(`open assessment lifecycle fixture ${lifecycle}`, "/api/visits", {
      method: "POST", body: JSON.stringify({ patientId: patient.id, clinic: "Walk-in", priority: "ROUTINE", visitType: "WALK_IN" }),
    })).body.visit;
    const input = { action: "SAVE_ASSESSMENT", expectedRevision: null, visitId: visit.id, servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", data, riskLevel: "ROUTINE" };
    const save = () => request("/api/service-points", { method: "POST", body: JSON.stringify(input) });
    const snapshot = async () => (await pg.query(`SELECT row_to_json(v) AS visit,
      (SELECT json_agg(e ORDER BY e.id) FROM "Encounter" e WHERE e."visitId"=v.id) AS encounters,
      (SELECT json_agg(r ORDER BY r.id) FROM "ServicePointRecord" r JOIN "Encounter" e ON e.id=r."encounterId" WHERE e."visitId"=v.id) AS records,
      (SELECT json_agg(q ORDER BY q.id) FROM "QueueEntry" q WHERE q."visitId"=v.id) AS queues,
    (SELECT json_agg(h ORDER BY h."recordId",h.version) FROM "ServicePointRevision" h WHERE h."visitId"=v.id) AS revisions,
      (SELECT json_agg(p ORDER BY p.id) FROM "PatientRelationship" p WHERE p."patientId"=v."patientId") AS relationships,
      (SELECT count(*)::int FROM "AuditEvent" a WHERE a.action='SERVICE_POINT_ASSESSMENT_SAVED' AND a."entityId" IN
        (SELECT r.id::text FROM "ServicePointRecord" r JOIN "Encounter" e ON e.id=r."encounterId" WHERE e."visitId"=v.id)) AS audits
      FROM "Visit" v WHERE v.id=$1`, [visit.id])).rows[0];
    if (index === 0) {
      const before = await snapshot();
      for (const [cookie, expectedStatus] of [[reception.cookie, 403], [foreignClinician.cookie, 404]]) {
        const deniedRead = await requestWithCookie(`/api/service-points?visitId=${visit.id}`, cookie);
        const deniedSave = await requestWithCookie("/api/service-points", cookie, { method: "POST", body: JSON.stringify(input) });
        assert(deniedRead.response.status === expectedStatus && deniedSave.response.status === expectedStatus, "Assessment failed role/facility isolation");
        assert(!deniedRead.body.record && !deniedSave.body.record, "Assessment denial disclosed record data");
      }
      assert(JSON.stringify(await snapshot()) === JSON.stringify(before), "Denied assessment access changed saved state");
      steps.push("verify native assessment permission and facility denial before disclosure or mutation");
      await pg.exec(`CREATE FUNCTION e2e_assessment_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action='SERVICE_POINT_ASSESSMENT_SAVED' THEN RAISE EXCEPTION 'synthetic assessment audit failure' USING ERRCODE='P0001'; END IF;
        RETURN NEW; END; $$;
        CREATE TRIGGER e2e_assessment_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION e2e_assessment_audit_failure();`);
      try {
        const failed = await save();
        assert(failed.response.status === 500 && !failed.body.record, "Assessment exposed success after audit failure");
        assert(JSON.stringify(await snapshot()) === JSON.stringify(before), "Assessment audit failure changed visit, encounter, record, queue or history");
        steps.push("verify native assessment audit failure rolls back the first record and encounter");
      } finally {
        await pg.exec('DROP TRIGGER e2e_assessment_audit_failure ON "AuditEvent"; DROP FUNCTION e2e_assessment_audit_failure();');
      }
    }
    const saved = await save();
    assert(saved.response.status === 200 && saved.body.record.updatedBy?.displayName, "Assessment save omitted recorder attribution");
    if (["SIGNED", "CORRECTED"].includes(lifecycle)) {
      await pg.query('UPDATE "Encounter" SET status=$1::"EncounterStatus", "signedAt"=CURRENT_TIMESTAMP WHERE id=$2', [lifecycle, saved.body.record.encounterId]);
    } else if (lifecycle === "DISCHARGED") {
      await pg.query('UPDATE "Visit" SET status=\'DISCHARGED\' WHERE id=$1', [visit.id]);
    } else {
      await pg.query('UPDATE "Visit" SET "clinicallyClosedAt"=CURRENT_TIMESTAMP WHERE id=$1', [visit.id]);
    }
    const before = await snapshot();
    const rejected = await save();
    assert(rejected.response.status === 409, `${lifecycle} assessment could be replaced`);
    if (["DISCHARGED", "CLOSED_TIMESTAMP"].includes(lifecycle)) {
      const linked = await request("/api/service-points", { method: "POST", body: JSON.stringify({ action: "LINK_PATIENT", visitId: visit.id, relatedPatientId, relationship: "GUARDIAN_OF" }) });
      assert(linked.response.status === 409, `${lifecycle} allowed a patient link`);
    }
    assert(JSON.stringify(await snapshot()) === JSON.stringify(before), `${lifecycle} denial changed saved state or history`);
    const read = await request(`/api/service-points?visitId=${visit.id}`);
    assert(read.response.status === 200 && read.body.readOnly === true && read.body.record.id === saved.body.record.id && read.body.record.updatedBy?.displayName, `${lifecycle} read lost retained record, attribution or read-only state`);
    assert(read.response.headers.get("cache-control") === "private, no-store", "Assessment disclosure became cacheable");
    steps.push(`verify ${lifecycle} assessment rejection retains record, queue, audit history and attributed read`);
    // Retire only this synthetic fixture's queues after the unchanged-state
    // assertions, so later queue tests do not inherit an in-progress patient.
    await pg.query('UPDATE "QueueEntry" SET status=\'COMPLETED\', "completedAt"=CURRENT_TIMESTAMP WHERE "visitId"=$1 AND status IN (\'WAITING\',\'CALLED\',\'IN_PROGRESS\')', [visit.id]);
  }
}
