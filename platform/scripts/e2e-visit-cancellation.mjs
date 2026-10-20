import { randomUUID } from "node:crypto";

// These records exist only in the disposable PGlite integration database.
async function seedVisit({ pg, facilityId, actorId, key, fullName, signed = false, orderStatus, paymentStatus, claimStatus, appointment = false }) {
  const patientId = randomUUID();
  const visitId = randomUUID();
  const invoiceId = randomUUID();
  const appointmentId = appointment ? randomUUID() : null;
  const visitNumber = `E2E-CANCEL-${key}`;
  await pg.query(`INSERT INTO "Patient" ("id","facilityId","patientNumber","fullName","normalizedName","estimatedAgeYears","sexAtBirth","updatedAt") VALUES ($1,$2,$3,$4,$5,35,'FEMALE',now())`, [patientId, facilityId, `E2E-P-${key}`, fullName, fullName.toLowerCase()]);
  if (appointmentId) await pg.query(`INSERT INTO "Appointment" ("id","facilityId","patientId","scheduledAt","clinic","status","updatedAt") VALUES ($1,$2,$3,now(),'Outpatient','COMPLETED',now())`, [appointmentId, facilityId, patientId]);
  await pg.query(`INSERT INTO "Visit" ("id","facilityId","patientId","appointmentId","visitNumber","clinic","visitType","status","reason","updatedAt") VALUES ($1,$2,$3,$4,$5,'Outpatient','WALK_IN','AWAITING_CLINICIAN','Synthetic cancellation fixture',now())`, [visitId, facilityId, patientId, appointmentId, visitNumber]);
  await pg.query(`INSERT INTO "QueueEntry" ("id","visitId","servicePoint","priority","status","enteredAt") VALUES ($1,$2,'CONSULTATION','ROUTINE','WAITING',$3)`, [randomUUID(), visitId, new Date(Date.now() - 2 * 60 * 60_000).toISOString()]);
  await pg.query(`INSERT INTO "Invoice" ("id","patientId","visitId","invoiceNumber","status","updatedAt") VALUES ($1,$2,$3,$4,'OPEN',now())`, [invoiceId, patientId, visitId, `E2E-INV-${key}`]);
  await pg.query(`INSERT INTO "InvoiceItem" ("id","invoiceId","serviceCode","description","quantity","unitPrice") VALUES ($1,$2,'SYNTHETIC-FEE','Synthetic consultation charge',1,500)`, [randomUUID(), invoiceId]);
  await pg.query(`INSERT INTO "Encounter" ("id","visitId","clinicianId","status","subjective","signedAt","updatedAt") VALUES ($1,$2,$3,$4,'Synthetic draft retained for record preservation',$5,now())`, [randomUUID(), visitId, actorId, signed ? "SIGNED" : "DRAFT", signed ? new Date().toISOString() : null]);
  if (orderStatus) await pg.query(`INSERT INTO "ClinicalOrder" ("id","visitId","orderedById","type","status","displayName") VALUES ($1,$2,$3,'LABORATORY',$4,'Private synthetic service name')`, [randomUUID(), visitId, actorId, orderStatus]);
  if (paymentStatus) await pg.query(`INSERT INTO "Payment" ("id","invoiceId","reference","method","status","amount","receivedById") VALUES ($1,$2,$3,'CASH',$4,500,$5)`, [randomUUID(), invoiceId, `E2E-PAY-${key}`, paymentStatus, actorId]);
  if (claimStatus) await pg.query(`INSERT INTO "Claim" ("id","invoiceId","createdById","payer","memberNumber","claimNumber","amount","status","updatedAt") VALUES ($1,$2,$3,'PRIVATE','SYNTHETIC-MEMBER',$4,500,$5,now())`, [randomUUID(), invoiceId, actorId, `E2E-CLAIM-${key}`, claimStatus]);
  return { patientId, visitId, invoiceId, appointmentId, visitNumber };
}

export async function verifyVisitCancellation({ pg, facilityId, actorId, adminCookie, requestWithCookie, authenticate, assert, steps }) {
  const reception = await authenticate("MMS", "shared.user@example.test");
  const otherReception = await authenticate("OTHER", "shared.user@example.test");
  const laboratory = await authenticate("MMS", "laboratory@example.test");
  const fixture = await seedVisit({ pg, facilityId, actorId, key: "PRESERVE", fullName: "Integration Cancellation Preserve", orderStatus: "REQUESTED", claimStatus: "DRAFT", appointment: true });
  await pg.query(`INSERT INTO "QueueEntry" ("id","visitId","servicePoint","priority","status") VALUES ($1,$2,'LABORATORY','ROUTINE','WAITING')`, [randomUUID(), fixture.visitId]);

  for (const email of ["clinician@example.test", "clinician.cover@example.test", "nurse@example.test", "medical.director@example.test"]) {
    const staff = await authenticate("MMS", email);
    assert(staff.body.user.permissions.includes("visit.cancel"), `${email} was missing the visit cancellation grant`);
    const preview = await requestWithCookie(`/api/visits/${fixture.visitId}/cancel`, staff.cookie);
    assert(preview.response.ok && preview.body.canCancel, `${email} could not review an undelivered visit for cancellation`);
  }
  steps.push("verify cancellation access for clinician, shortage cover, nurse and medical director");

  const list = await requestWithCookie(`/api/visits/cancellation-worklist?q=${fixture.visitNumber}`, reception.cookie);
  assert(list.response.ok && list.body.visits.some(item => item.id === fixture.visitId), "Reception could not find a visit outside its service-point queue");
  const item = list.body.visits.find(entry => entry.id === fixture.visitId);
  assert(!("encounters" in item) && !("invoice" in item) && !("orders" in item) && !("reason" in item), "Cancellation worklist disclosed clinical or financial records to reception");
  assert(list.response.headers.get("cache-control")?.includes("no-store"), "Cancellation worklist was cacheable");
  const preview = await requestWithCookie(`/api/visits/${fixture.visitId}/cancel?reasonCode=OVERDUE_UNPROCESSED`, reception.cookie);
  assert(preview.response.ok && preview.body.canCancel && preview.body.overdueEligible, "Reception could not preview a reviewed overdue visit");
  assert(preview.body.impact.activeQueues === 2 && preview.body.impact.pendingOrders === 1 && preview.body.impact.draftClaims === 1 && preview.body.impact.voidInvoice && preview.body.impact.cancelAppointment, "Cancellation preview omitted dependent records");
  assert(preview.response.headers.get("cache-control")?.includes("no-store"), "Cancellation preview was cacheable");
  assert(!JSON.stringify(preview.body).includes("Private synthetic service name"), "Cancellation preview disclosed clinical service details");
  assert((await pg.query(`SELECT "status" FROM "Visit" WHERE "id"=$1`, [fixture.visitId])).rows[0].status === "AWAITING_CLINICIAN", "Previewing cancellation changed the visit");

  for (const pathname of [`/api/visits/${fixture.visitId}/cancel`, "/api/visits/cancellation-worklist"]) {
    const denied = await requestWithCookie(pathname, laboratory.cookie);
    assert(denied.response.status === 403, "Laboratory staff accessed cancellation without permission");
  }
  const cancellationInput = { reasonCode: "OVERDUE_UNPROCESSED", details: "Attendance reviewed: patient left before care; return instructions documented." };
  const deniedPost = await requestWithCookie(`/api/visits/${fixture.visitId}/cancel`, laboratory.cookie, { method: "POST", body: JSON.stringify(cancellationInput) });
  assert(deniedPost.response.status === 403, "Laboratory staff cancelled a visit without permission");
  const crossTenantPreview = await requestWithCookie(`/api/visits/${fixture.visitId}/cancel`, otherReception.cookie);
  const crossTenantPost = await requestWithCookie(`/api/visits/${fixture.visitId}/cancel`, otherReception.cookie, { method: "POST", body: JSON.stringify(cancellationInput) });
  const crossTenantList = await requestWithCookie(`/api/visits/cancellation-worklist?q=${fixture.visitNumber}`, otherReception.cookie);
  assert(crossTenantPreview.response.status === 404 && crossTenantPost.response.status === 404 && crossTenantList.response.ok && crossTenantList.body.visits.length === 0, "Cancellation crossed the facility boundary");
  steps.push("verify cancellation discovery, least-privilege preview, permissions and facility isolation");

  const cancelled = await requestWithCookie(`/api/visits/${fixture.visitId}/cancel`, reception.cookie, { method: "POST", body: JSON.stringify(cancellationInput) });
  assert(cancelled.response.ok, `Documented reception cancellation failed: ${JSON.stringify(cancelled.body)}`);
  const preserved = (await pg.query(`SELECT v."status", p."active", i."status" AS "invoiceStatus",
    c."reasonCode", c."details", c."cancelledById", c."cancelledAt",
    (SELECT COUNT(*)::int FROM "InvoiceItem" WHERE "invoiceId"=i."id") AS "invoiceItems",
    (SELECT COUNT(*)::int FROM "QueueEntry" WHERE "visitId"=v."id" AND "status"='CANCELLED') AS "cancelledQueues",
    (SELECT COUNT(*)::int FROM "QueueEntry" WHERE "visitId"=v."id" AND "status" IN ('WAITING','CALLED','IN_PROGRESS')) AS "activeQueues",
    (SELECT COUNT(*)::int FROM "ClinicalOrder" WHERE "visitId"=v."id" AND "status"='CANCELLED') AS "cancelledOrders",
    (SELECT COUNT(*)::int FROM "Claim" WHERE "invoiceId"=i."id" AND "status"='CANCELLED') AS "cancelledClaims",
    (SELECT COUNT(*)::int FROM "Encounter" WHERE "visitId"=v."id" AND "subjective"='Synthetic draft retained for record preservation') AS "retainedNotes",
    (SELECT "status" FROM "Appointment" WHERE "id"=v."appointmentId") AS "appointmentStatus",
    (SELECT COUNT(*)::int FROM "AuditEvent" WHERE "entityId"=v."id"::text AND "action"='VISIT_CANCELLED' AND "facilityId"=v."facilityId" AND "userId"=c."cancelledById" AND "sessionId" IS NOT NULL) AS "auditCount"
    FROM "Visit" v JOIN "Patient" p ON p."id"=v."patientId" JOIN "Invoice" i ON i."visitId"=v."id" JOIN "VisitCancellation" c ON c."visitId"=v."id" WHERE v."id"=$1`, [fixture.visitId])).rows[0];
  assert(preserved.status === "CANCELLED" && preserved.invoiceStatus === "VOID" && preserved.appointmentStatus === "CANCELLED", "Cancellation did not close dependent operational records");
  assert(preserved.active && preserved.invoiceItems === 1 && preserved.retainedNotes === 1, "Cancellation deleted the patient, original charge or draft clinical notes");
  assert(preserved.cancelledQueues === 2 && preserved.activeQueues === 0 && preserved.cancelledOrders === 1 && preserved.cancelledClaims === 1, "Cancellation left active queue, order or draft claim records");
  assert(preserved.reasonCode === cancellationInput.reasonCode && preserved.details === cancellationInput.details && preserved.cancelledAt && preserved.auditCount === 1, "Cancellation omitted its reason, timestamp or actor-bound audit evidence");
  const remaining = await requestWithCookie(`/api/visits/cancellation-worklist?q=${fixture.visitNumber}`, reception.cookie);
  const activeWorklist = await requestWithCookie("/api/visits", reception.cookie);
  const history = await requestWithCookie(`/api/patients/${fixture.patientId}/history`, adminCookie);
  assert(remaining.response.ok && remaining.body.visits.length === 0 && !activeWorklist.body.visits.some(item => item.id === fixture.visitId), "Cancelled visit remained in the active worklist");
  assert(history.response.ok && history.body.timeline.some(item => item.id === `visit-${fixture.visitId}` && item.detail.includes("CANCELLED") && item.detail.includes(cancellationInput.details)), "Cancelled visit disappeared from the patient history");
  const repeated = await requestWithCookie(`/api/visits/${fixture.visitId}/cancel`, reception.cookie, { method: "POST", body: JSON.stringify(cancellationInput) });
  assert(repeated.response.status === 409, "Repeated cancellation was accepted");
  assert((await pg.query(`SELECT COUNT(*)::int AS count FROM "AuditEvent" WHERE "entityId"=$1 AND "action"='VISIT_CANCELLED'`, [fixture.visitId])).rows[0].count === 1, "Repeated cancellation created duplicate audit evidence");
  steps.push("verify cancellation closes work once while preserving patient, charge, notes, reason and audit history");

  const blockedCases = [
    { key: "SIGNED", signed: true, blocker: /signed/i },
    { key: "PERFORMED", orderStatus: "COMPLETED", blocker: /completed care/i },
    { key: "IN-PROGRESS", orderStatus: "IN_PROGRESS", blocker: /in progress/i },
    { key: "PAID", paymentStatus: "CONFIRMED", blocker: /payment/i },
    { key: "PENDING-PAYMENT", paymentStatus: "PENDING", blocker: /payment/i },
    { key: "REJECTED-CLAIM", claimStatus: "REJECTED", blocker: /claim/i },
  ];
  for (const blockedCase of blockedCases) {
    const blocked = await seedVisit({ pg, facilityId, actorId, fullName: `Integration Cancellation ${blockedCase.key}`, ...blockedCase });
    const review = await requestWithCookie(`/api/visits/${blocked.visitId}/cancel`, reception.cookie);
    assert(review.response.ok && !review.body.canCancel && review.body.blockers.some(message => blockedCase.blocker.test(message)), `Cancellation preview failed to explain ${blockedCase.key}`);
    assert(!JSON.stringify(review.body).includes("Private synthetic service name"), "Blocker exposed a completed service name to reception");
    const result = await requestWithCookie(`/api/visits/${blocked.visitId}/cancel`, reception.cookie, { method: "POST", body: JSON.stringify({ reasonCode: "PATIENT_REQUEST", details: "Synthetic cancellation safeguard regression." }) });
    assert(result.response.status === 409, `Cancellation accepted protected ${blockedCase.key} work`);
    const state = (await pg.query(`SELECT v."status", i."status" AS "invoiceStatus", (SELECT COUNT(*)::int FROM "VisitCancellation" WHERE "visitId"=v."id") AS cancellations FROM "Visit" v JOIN "Invoice" i ON i."visitId"=v."id" WHERE v."id"=$1`, [blocked.visitId])).rows[0];
    assert(state.status === "AWAITING_CLINICIAN" && state.invoiceStatus === "OPEN" && state.cancellations === 0, `Blocked ${blockedCase.key} cancellation partially changed records`);
  }
  steps.push("verify signed care, performed or in-progress services, payments and rejected claims block cancellation");

  const stale = await seedVisit({ pg, facilityId, actorId, key: "STALE", fullName: "Integration Cancellation Stale Review" });
  const before = await requestWithCookie(`/api/visits/${stale.visitId}/cancel`, reception.cookie);
  assert(before.response.ok && before.body.canCancel, "Stale-review test did not start cancellable");
  await pg.query(`UPDATE "Encounter" SET "status"='SIGNED',"signedAt"=now() WHERE "visitId"=$1`, [stale.visitId]);
  const after = await requestWithCookie(`/api/visits/${stale.visitId}/cancel`, reception.cookie, { method: "POST", body: JSON.stringify({ reasonCode: "PATIENT_REQUEST", details: "Synthetic stale preview must not override new clinical work." }) });
  assert(after.response.status === 409, "A stale cancellation preview overrode newly signed care");
  steps.push("verify cancellation rechecks current care after the confirmation preview");
}

export async function seedCancellationBrowserFixtures({ pg, facilityId, actorId }) {
  // Cancellation is terminal, so retries receive independent records.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const role of ["Reception", "Cover"]) await seedVisit({ pg, facilityId, actorId, key: `BROWSER-${role.toUpperCase()}${attempt ? `-RETRY-${attempt}` : ""}`, fullName: attempt ? `Browser Retry ${attempt} Cancel ${role}` : `Browser Cancel ${role}` });
  }
  for (const fixture of [
    { key: "BROWSER-SIGNED", fullName: "Browser Cancel Signed", signed: true },
    { key: "BROWSER-PERFORMED", fullName: "Browser Cancel Performed", orderStatus: "COMPLETED" },
    { key: "BROWSER-PAID", fullName: "Browser Cancel Paid", paymentStatus: "CONFIRMED" },
    { key: "BROWSER-MOBILE", fullName: "Browser Cancel Mobile" },
  ]) await seedVisit({ pg, facilityId, actorId, ...fixture });
}
