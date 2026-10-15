import { randomUUID } from "node:crypto";

// Runs only in the isolated PGlite fixture; every medicine and visit is synthetic.
export async function verifyPrescriptionList({
  pg,
  api,
  requestWithCookie,
  authenticate,
  sessionCookie,
  facility,
  patient,
  admin,
  assert,
  steps,
}) {
  const id = randomUUID(),
    encounterId = randomUUID();
  await pg.query(
    'INSERT INTO "Visit" (id,"facilityId","patientId","visitNumber",clinic,"visitType",status,reason,"updatedAt") VALUES ($1,$2,$3,$4,\'Outpatient\',\'WALK_IN\',\'UNDER_CONSULTATION\',\'Synthetic prescription list\',now())',
    [id, facility.id, patient.id, "RX-" + id],
  );
  await pg.query(
    'INSERT INTO "Encounter" (id,"visitId","clinicianId",status,subjective,"updatedAt") VALUES ($1,$2,$3,\'DRAFT\',\'Synthetic medication review\',now())',
    [encounterId, id, admin.id],
  );
  await pg.query(
    "INSERT INTO \"Diagnosis\" (id,\"encounterId\",type,description,code,\"primary\") VALUES ($1,$2,'FINAL','Synthetic indication','MG30.0',true)",
    [randomUUID(), encounterId],
  );
  for (const code of ["RX-LIST-A", "RX-LIST-B", "RX-LIST-C"])
    await pg.query(
      'INSERT INTO "CatalogItem" (id,"facilityId",category,code,name,"genericName","medicationConceptId",strength,"dosageForm","unitOfMeasure","unitPrice","updatedAt") VALUES ($1,$2,\'PHARMACEUTICAL\',$3,$3,$3,$3,\'synthetic strength\',\'Tablet\',\'tablet\',10,now())',
      [randomUUID(), facility.id, code],
    );
  const path = "/api/visits/" + id + "/consultation";
  const line = (code) => ({
    medicineCode: code,
    indication: "Synthetic indication",
    dose: "1 tablet",
    doseQuantity: 1,
    route: "Oral",
    frequency: "Once daily",
    frequencyPerDay: 1,
    duration: "2 days",
    durationDays: 2,
    startDate: "2026-10-16",
    quantity: 2,
    quantityConfirmed: true,
    instructions: "Synthetic test instructions",
  });
  const send = (data, cookie = sessionCookie) =>
    requestWithCookie(path, cookie, {
      method: "POST",
      body: JSON.stringify({ action: "SAVE_PRESCRIPTION", data }),
    });
  const rows = async () =>
    (
      await pg.query(
        'SELECT o.id,o.status,p."idempotencyKey",p.quantity FROM "ClinicalOrder" o JOIN "Prescription" p ON p."orderId"=o.id WHERE o."visitId"=$1 ORDER BY o."displayName"',
        [id],
      )
    ).rows;
  const bad = {
    submit: false,
    idempotencyKey: randomUUID(),
    prescriptions: [line("RX-LIST-A"), line("RX-NOT-AVAILABLE")],
  };
  assert(
    (await send(bad)).response.status === 400 && (await rows()).length === 0,
    "Invalid second medicine left a partial list",
  );
  const draft = {
    submit: false,
    idempotencyKey: randomUUID(),
    prescriptions: [line("RX-LIST-A"), line("RX-LIST-B")],
  };
  const ruleId=randomUUID();
  await pg.query('INSERT INTO "MedicationSafetyRule" (id,"facilityId",code,kind,severity,status,"primaryConceptId","interactingConceptId",rule,"sourceReference",version,"approvedById","approvedAt","updatedAt") VALUES ($1,$2,\'RX-LIST-SYNTHETIC\',\'INTERACTION\',\'HARD_STOP\',\'APPROVED\',\'RX-LIST-A\',\'RX-LIST-B\',$3,\'Synthetic fixture only\',\'1\',$4,now(),now())',[ruleId,facility.id,JSON.stringify({kind:'INTERACTION',message:'Synthetic interaction blocks this list'}),admin.id]);
  for(const prescriptions of [draft.prescriptions,[...draft.prescriptions].reverse()]) {
    const blocked=await send({...draft,idempotencyKey:randomUUID(),prescriptions});
    assert(blocked.response.status===422 && (await rows()).length===0,'Batch order bypassed an approved interaction hard stop');
  }
  await pg.query('DELETE FROM "MedicationSafetyRule" WHERE id=$1',[ruleId]);

  const saved = await send(draft);
  assert(
    saved.response.ok && saved.body.orders.length === 2,
    "Two-medicine draft did not save atomically",
  );
  const original = await rows();
  assert(
    original.every((r) => r.status === "DRAFT") &&
      new Set(original.map((r) => r.idempotencyKey)).size === 2,
    "Draft reused line identity",
  );
  assert(
    (await send(draft)).body.stage === "PRESCRIPTION_ALREADY_SAVED" &&
      (await rows()).length === 2,
    "Exact retry duplicated medicines",
  );
  assert(
    (await send({ ...draft, submit: true })).response.status === 409,
    "Changed retry was accepted",
  );
  const clinician = await authenticate("MMS", "clinician@example.test");
  assert(
    (await send(draft, clinician.cookie)).response.status === 409,
    "Another actor replayed the prescription receipt",
  );
  const reception = await authenticate("MMS", "reception@example.test");
  assert(
    (await send({ ...draft, idempotencyKey: randomUUID() }, reception.cookie))
      .response.status === 403,
    "Reception prescribed medicines",
  );
  const other = await authenticate("OTHER", "diagnostic.other@example.test");
  assert(
    (await requestWithCookie(path, other.cookie)).response.status === 404,
    "Other facility read prescriptions",
  );
  assert(
    (await send({ ...draft, idempotencyKey: randomUUID() }, other.cookie))
      .response.status === 404,
    "Other facility changed prescriptions",
  );
  const review = {
    submit: true,
    idempotencyKey: randomUUID(),
    prescriptions: draft.prescriptions.map((item, i) => ({
      ...item,
      existingOrderId: original[i].id,
      expectedPrescriptionKey: original[i].idempotencyKey,
    })),
  };
  await pg.exec(
    "CREATE FUNCTION reject_rx_list_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PRESCRIPTION_SUBMITTED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_rx_list_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_rx_list_audit();",
  );
  try {
    assert(
      (await send(review)).response.status === 500,
      "Prescription save ignored audit failure",
    );
  } finally {
    await pg.exec(
      'DROP TRIGGER reject_rx_list_audit ON "AuditEvent"; DROP FUNCTION reject_rx_list_audit();',
    );
  }
  assert(
    (await rows()).every((r) => r.status === "DRAFT"),
    "Audit failure partly submitted the list",
  );
  const submitted = await send(review);
  assert(
    submitted.response.ok &&
      (await rows()).every((r) => r.status === "REQUESTED"),
    "Reviewed draft did not submit",
  );
  assert(
    (await rows()).map((r) => r.id).join() === original.map((r) => r.id).join(),
    "Submitting draft created new orders",
  );
  assert(
    (await send({ ...review, idempotencyKey: randomUUID() })).response
      .status === 409,
    "Stale revision overwrote medicines",
  );
  assert(
    (await send(review)).body.stage === "PRESCRIPTION_ALREADY_SAVED",
    "Lost submit response was not recoverable",
  );
  const first = (await rows())[0];
  const correction = {
    submit: true,
    idempotencyKey: randomUUID(),
    prescriptions: [
      {
        ...line("RX-LIST-A"),
        existingOrderId: first.id,
        expectedPrescriptionKey: first.idempotencyKey,
        quantity: 3,
      },
    ],
  };
  assert(
    (await send(correction)).response.status === 422,
    "Sent correction lacked a clinical reason",
  );
  correction.prescriptions[0].correctionReason =
    "Synthetic correction after review";
  assert((await send(correction)).response.ok, "Valid correction failed");
  const beforeSupply = (await rows())[0];
  await pg.query(
    'UPDATE "Prescription" SET "dispensedQuantity"=1,"dispenseStatus"=\'PARTIALLY_DISPENSED\' WHERE "orderId"=$1',
    [first.id],
  );
  assert(
    (
      await send({
        ...correction,
        idempotencyKey: randomUUID(),
        prescriptions: [
          {
            ...correction.prescriptions[0],
            expectedPrescriptionKey: beforeSupply.idempotencyKey,
            quantity: 4,
          },
        ],
      })
    ).response.status === 409,
    "Supplied medicine was overwritten",
  );
  assert(
    (
      await pg.query(
        'SELECT count(*)::int AS n FROM "InvoiceItem" WHERE "orderId"=ANY($1::uuid[])',
        [original.map((r) => r.id)],
      )
    ).rows[0].n === 0,
    "Prescribing billed unsupplied medicine",
  );
  const audit = await pg.query(
    'SELECT count(*)::int AS n FROM "AuditEvent" WHERE "entityId"=$1 AND action=\'PRESCRIPTION_DRAFT_SAVED\'',
    [encounterId],
  );
  assert(audit.rows[0].n === 1, "Draft retry duplicated its committed audit");
  // End this synthetic visit so later fixture scenarios can open their own visit.
  await pg.query('UPDATE "Visit" SET status=\'CANCELLED\' WHERE id=$1',[id]);
  steps.push(
    "verify atomic multi-medicine saves, exact actor-bound retry, draft revision, authorization, facility isolation, audit rollback and supplied-order protection",
  );
}
