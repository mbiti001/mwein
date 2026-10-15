import { randomUUID } from "node:crypto";

// Runs only inside the disposable synthetic outpatient fixture.
export async function verifyDocumentNumbering({ pg, requestWithCookie, sessionCookie, facility, admin, assert, steps }) {
  const state = async () => JSON.stringify((await pg.query(`SELECT "year", "nextValue"::text FROM "ReferenceSequence" WHERE "facilityId"=$1 AND "kind"='CLINIC_DOCUMENT_DELIVERY' ORDER BY "year"`, [facility.id])).rows);
  const before = await state();
  const key = randomUUID();
  const input = { kind: "DELIVERY", visitId: null, payload: {}, requestKey: key };
  await pg.exec(`CREATE FUNCTION reject_numbering_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action"='CLINIC_DOCUMENT_CREATED' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER numbering_audit_test BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_numbering_audit_test();`);
  try {
    const failure = await requestWithCookie("/api/clinic-documents", sessionCookie, { method: "POST", body: JSON.stringify(input) });
    assert(failure.response.status === 500, "Synthetic audit failure unexpectedly saved a document");
    assert(await state() === before, "Failed audit consumed the document sequence");
    assert(Number((await pg.query('SELECT COUNT(*) FROM "ClinicDocument" WHERE "creationKey"=$1', [key])).rows[0].count) === 0, "Failed audit left a document or replay receipt");
  } finally { await pg.exec('DROP TRIGGER numbering_audit_test ON "AuditEvent"; DROP FUNCTION reject_numbering_audit_test();'); }
  const created = await requestWithCookie("/api/clinic-documents", sessionCookie, { method: "POST", body: JSON.stringify(input) });
  const repeated = await requestWithCookie("/api/clinic-documents", sessionCookie, { method: "POST", body: JSON.stringify(input) });
  assert(created.response.status === 201 && repeated.response.status === 200 && created.body.document.reference === repeated.body.document.reference, "Retry did not retain its original serial");
  steps.push("verify document counter, creation receipt and audit roll back together");

  const legacyId = randomUUID(), legacyReference = `${facility.code}-DELIVERY-${legacyId}`;
  const payload = { date: "2026-10-16", supplier: "Synthetic legacy supplier", recipient: "Synthetic store", orderReference: "LEGACY-TEST", items: "Synthetic retained legacy note", deliveredBy: "Synthetic courier" };
  const context = { facilityName: facility.name, facilityCode: facility.code, timezone: "Africa/Nairobi" };
  await pg.query(`INSERT INTO "ClinicDocument" ("id", "facilityId", "kind", "reference", "payload", "context", "authorId", "signerRoles", "updatedAt") VALUES ($1,$2,'DELIVERY',$3,$4,$5,$6,ARRAY[]::text[],now())`, [legacyId, facility.id, legacyReference, JSON.stringify(payload), JSON.stringify(context), admin.id]);
  const signed = await requestWithCookie("/api/clinic-documents", sessionCookie, { method: "PATCH", body: JSON.stringify({ id: legacyId, kind: "DELIVERY", version: 1, action: "SIGN", attested: true }) });
  assert(signed.response.status === 200 && signed.body.document.reference === legacyReference, "Signing rewrote a historical reference");
  const correction = await requestWithCookie("/api/clinic-documents", sessionCookie, { method: "PATCH", body: JSON.stringify({ id: legacyId, kind: "DELIVERY", version: signed.body.document.version, action: "CORRECT", requestKey: randomUUID(), reason: "Synthetic correction preserving legacy evidence" }) });
  assert(correction.response.status === 200 && /^.+-DELIVERY-\d{4}-\d{6,}$/.test(correction.body.document.reference), "Legacy correction did not receive a structured number");
  assert(correction.body.document.previous.reference === legacyReference, "Correction lost its original reference");
  const original = (await pg.query('SELECT "reference", "contentHash" FROM "ClinicDocument" WHERE "id"=$1', [legacyId])).rows[0];
  assert(original.reference === legacyReference && original.contentHash === signed.body.document.contentHash, "Legacy signed reference or fingerprint changed");
  steps.push("verify legacy signed references and hashes survive numbered corrections");
}
