import { randomUUID } from "node:crypto";

// Invoked exclusively by the guarded, empty synthetic database fixture.
export async function verifyPrescribingDefaults({ pg, api, requestWithCookie, authenticate, sessionCookie, facility, patient, admin, assert, steps }) {
  const visitId = randomUUID(), encounterId = randomUUID();
  await pg.query(`INSERT INTO "Visit" (id,"facilityId","patientId","visitNumber",clinic,"visitType",status,reason,"updatedAt") VALUES ($1,$2,$3,$4,'Outpatient','WALK_IN','UNDER_CONSULTATION','Synthetic compact prescription',now())`, [visitId,facility.id,patient.id,"RX-COMPACT-"+visitId]);
  await pg.query(`INSERT INTO "Encounter" (id,"visitId","clinicianId",status,subjective,"updatedAt") VALUES ($1,$2,$3,'DRAFT','Synthetic review without diagnosis',now())`, [encounterId,visitId,admin.id]);
  const defaults = { route:"Oral", frequencyPerDay:3, durationDays:7, doseUnit:"mL", doseUnitsPerIssueUnit:100, wholeIssueUnits:true };
  const input = { category:"PHARMACEUTICAL", code:"RX-COMPACT-LIQUID", name:"Synthetic compact liquid", genericName:"Synthetic compact liquid", medicationConceptId:"synthetic-compact-liquid", strength:"Synthetic strength", dosageForm:"Liquid", unitOfMeasure:"bottle", unitPrice:10, prescribingDefaults:defaults };
  const created = await api("configure facility medicine defaults", "/api/catalog", {method:"POST",body:JSON.stringify(input)});
  const item = created.body.item;
  assert(item.prescribingDefaults.doseUnitsPerIssueUnit === 100, "Facility conversion not saved");
  const changed = {...input,id:item.id,prescribingDefaults:{...defaults,durationDays:8}};
  const missingRevision = await requestWithCookie("/api/catalog",sessionCookie,{method:"PATCH",body:JSON.stringify(changed)});
  assert(missingRevision.response.status===428,"Configuration change without a reviewed revision was accepted");
  const staleRevision = await requestWithCookie("/api/catalog",sessionCookie,{method:"PATCH",body:JSON.stringify({...changed,expectedUpdatedAt:"2020-01-01T00:00:00.000Z"})});
  assert(staleRevision.response.status===409,"Stale catalogue form overwrote another update");
  const clinician = await authenticate("MMS","clinician@example.test");
  const denied = await requestWithCookie("/api/catalog",clinician.cookie,{method:"PATCH",body:JSON.stringify({...input,id:item.id})});
  assert(denied.response.status===403,"Prescriber could change administrative defaults");
  const other = await authenticate("OTHER","diagnostic.other@example.test");
  const foreign = await requestWithCookie("/api/catalog",other.cookie);
  assert(foreign.response.ok && !foreign.body.items.some(row=>row.id===item.id),"Another facility received medicine defaults");
  steps.push("verify facility-scoped medicine defaults and configuration permission");
  const path=`/api/visits/${visitId}/consultation`;
  const line={medicineCode:input.code,dose:"5 mL",doseQuantity:0.05,route:"Oral",frequency:"Three times daily",frequencyPerDay:3,duration:"7 days",durationDays:7,startDate:new Date().toISOString().slice(0,10),quantity:2,quantityConfirmed:true,instructions:"Synthetic directions only",calculationDefaults:defaults};
  const send = data=>requestWithCookie(path,sessionCookie,{method:"POST",body:JSON.stringify({action:"SAVE_PRESCRIPTION",data})});
  const payload={submit:false,idempotencyKey:randomUUID(),prescriptions:[line]};
  const forged=await send({...payload,prescriptions:[{...line,quantity:1}]});
  assert(forged.response.status===422,"Forged calculated quantity was accepted");
  const stale=await send({...payload,prescriptions:[{...line,calculationDefaults:{...defaults,doseUnitsPerIssueUnit:50}}]});
  assert(stale.response.status===409,"Stale facility conversion was accepted");
  assert((await pg.query('SELECT id FROM "ClinicalOrder" WHERE "visitId"=$1',[visitId])).rows.length===0,"Rejected calculation left partial prescription");
  const saved=await send(payload);
  assert(saved.response.ok,`Prescription without diagnosis/indication failed: ${JSON.stringify(saved.body)}`);
  const stored=(await pg.query('SELECT p.* FROM "Prescription" p JOIN "ClinicalOrder" o ON o.id=p."orderId" WHERE o."visitId"=$1',[visitId])).rows[0];
  assert(stored.diagnosisId===null && Number(stored.quantity)===2 && Number(stored.doseQuantity)===0.05,"Single dose conversion or optional diagnosis did not persist");
  assert((await send(payload)).body.stage==="PRESCRIPTION_ALREADY_SAVED","Unchanged compact prescription retry duplicated a line");
  steps.push("verify prescription without diagnosis or indication, liquid arithmetic, stale/forged rejection and exact retry");
  const sign=await requestWithCookie(path,sessionCookie,{method:"POST",body:JSON.stringify({action:"SIGN",expectedRevision:`${encounterId}:${(await pg.query('SELECT "updatedAt" FROM "Encounter" WHERE id=$1',[encounterId])).rows[0].updatedAt.toISOString()}`,data:{disposition:"OUTPATIENT"}})});
  assert(sign.response.status===409,"Optional prescription diagnosis removed consultation signing gate");
  await pg.exec(`CREATE FUNCTION e2e_rx_config_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $rx$ BEGIN IF NEW.action='CATALOG_ITEM_UPDATED' AND NEW."entityId"='${item.id}' THEN RAISE EXCEPTION 'Synthetic config audit failure'; END IF; RETURN NEW; END; $rx$; CREATE TRIGGER e2e_rx_config_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION e2e_rx_config_audit_failure();`);
  try {
    const failed=await requestWithCookie("/api/catalog",sessionCookie,{method:"PATCH",body:JSON.stringify({...input,id:item.id,expectedUpdatedAt:item.updatedAt,prescribingDefaults:{...defaults,durationDays:8}})});
    assert(failed.response.status===500,"Failed configuration audit reported success");
    const retained=(await pg.query('SELECT "prescribingDefaults" FROM "CatalogItem" WHERE id=$1',[item.id])).rows[0].prescribingDefaults;
    assert(retained.durationDays===7,"Failed audit retained unaudited configuration");
  } finally { await pg.exec('DROP TRIGGER e2e_rx_config_audit_failure ON "AuditEvent"; DROP FUNCTION e2e_rx_config_audit_failure();'); }
  const audit=(await pg.query('SELECT * FROM "AuditEvent" WHERE "entityId"=$1 AND action=\'CATALOG_ITEM_CREATED\'',[item.id])).rows[0];
  assert(audit.facilityId===facility.id && audit.userId===admin.id && audit.sessionId && audit.afterHash.length===64,"Configuration audit omitted provenance");
  const cleared=await requestWithCookie("/api/catalog",sessionCookie,{method:"PATCH",body:JSON.stringify({...input,id:item.id,expectedUpdatedAt:item.updatedAt,prescribingDefaults:null})});
  assert(cleared.response.ok && cleared.body.item.prescribingDefaults===null,"Facility could not explicitly remove defaults");
  assert((await send(payload)).body.stage==="PRESCRIPTION_ALREADY_SAVED","Later configuration change broke confirmation of a previously committed prescription");
  await pg.query('UPDATE "Visit" SET status=\'CANCELLED\' WHERE id=$1',[visitId]);
  steps.push("verify native configuration audit rollback, provenance and retained consultation signing gate");
}
