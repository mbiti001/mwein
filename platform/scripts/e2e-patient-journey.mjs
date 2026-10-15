import { randomUUID } from "node:crypto";

// Only called by the isolated synthetic PGlite workflow fixture.
export async function verifyPatientJourney({ pg, api, requestWithCookie, sessionCookie, facility, patient, admin, assert, steps }) {
  const id = randomUUID(), encounterId = randomUUID();
  await pg.query(`INSERT INTO "Visit" (id,"facilityId","patientId","visitNumber",clinic,"visitType",status,reason,"updatedAt") VALUES ($1,$2,$3,'E2E-JOURNEY','Outpatient','WALK_IN','AWAITING_RESULTS','Synthetic patient journey',now())`, [id, facility.id, patient.id]);
  await pg.query(`INSERT INTO "Encounter" (id,"visitId","clinicianId",status,plan,"updatedAt") VALUES ($1,$2,$3,'DRAFT',$4,now())`, [encounterId,id,admin.id,JSON.stringify({plan:"Synthetic follow-up and return precautions recorded"})]);
  await pg.query(`INSERT INTO "Diagnosis" (id,"encounterId",type,description,code,"primary") VALUES ($1,$2,'FINAL','Synthetic diagnosis','MG30.0',true)`, [randomUUID(),encounterId]);
  async function order(type, status = 'REQUESTED') {
    const orderId=randomUUID();
    await pg.query(`INSERT INTO "ClinicalOrder" (id,"visitId","orderedById",type,status,"displayName") VALUES ($1,$2,$3,$4,$5,$6)`,[orderId,id,admin.id,type,status,`Synthetic ${type}`]);
    if(type==='LABORATORY') await pg.query(`INSERT INTO "LaboratoryOrder" (id,"orderId","testCode","specimenType","specimenStatus") VALUES ($1,$2,'JOURNEY-TEST','Blood','ACCEPTED')`,[randomUUID(),orderId]);
    if(type==='IMAGING') await pg.query(`INSERT INTO "ImagingOrder" (id,"orderId","examinationCode",modality) VALUES ($1,$2,'JOURNEY-IMAGE','XRAY')`,[randomUUID(),orderId]);
    if(type==='MEDICATION') await pg.query(`INSERT INTO "Prescription" (id,"orderId","medicineCode",dose,route,frequency,quantity,instructions) VALUES ($1,$2,'SYNTHETIC','1','ORAL','ONCE',1,'Synthetic only')`,[randomUUID(),orderId]);
    return orderId;
  }
  async function task(point) { await pg.query(`INSERT INTO "QueueEntry" (id,"visitId","servicePoint",priority) VALUES ($1,$2,$3,'ROUTINE')`,[randomUUID(),id,point]); }
  const lab=await order('LABORATORY'), image=await order('IMAGING'), medicine=await order('MEDICATION');
  for(const point of ['LABORATORY','IMAGING','PHARMACY']) await task(point);
  const state=async()=> (await pg.query(`SELECT status,(SELECT count(*)::int FROM "QueueEntry" q WHERE q."visitId"=v.id AND q.status IN ('WAITING','CALLED','IN_PROGRESS') AND q."servicePoint"='BILLING') AS billing,(SELECT count(*)::int FROM "QueueEntry" q WHERE q."visitId"=v.id AND q.status IN ('WAITING','CALLED','IN_PROGRESS') AND q."servicePoint"='CONSULTATION') AS consultation FROM "Visit" v WHERE v.id=$1`,[id])).rows[0];
  await api('finish early pharmacy task without bypassing diagnostics',`/api/orders/${medicine}/dispense`,{method:'POST',body:JSON.stringify({action:'NOT_DISPENSED',idempotencyKey:randomUUID(),notes:'Synthetic: return to clinician for alternative plan'})});
  assert((await state()).status==='AWAITING_RESULTS' && (await state()).billing===0,'Early pharmacy completion bypassed clinical work');
  const diagnosticRequests=await Promise.all([
    requestWithCookie(`/api/orders/${lab}/laboratory-result`,sessionCookie,{method:'POST',body:JSON.stringify({action:'VERIFY',items:[{analyte:'Synthetic',value:'Normal'}]})}),
    requestWithCookie(`/api/orders/${image}/imaging-result`,sessionCookie,{method:'POST',body:JSON.stringify({action:'VERIFY',findings:'Synthetic normal findings',conclusion:'Synthetic completed report'})}),
  ]);
  assert(diagnosticRequests.every(result=>result.response.ok),`Concurrent diagnostics failed: ${JSON.stringify(diagnosticRequests.map(result=>result.body))}`);
  assert((await state()).status==='AWAITING_CLINICIAN' && (await state()).consultation===1,'Final parallel results lost or duplicated the consultation handoff');
  const cancelImage=await order('IMAGING'); await task('IMAGING');
  await api('return cancelled imaging to the existing consultation task',`/api/orders/${cancelImage}/imaging-result`,{method:'POST',body:JSON.stringify({action:'CANCEL',reason:'Synthetic duplicate examination cancelled'})});
  assert((await state()).consultation===1,'Imaging cancellation duplicated consultation');
  const partial=await order('MEDICATION','IN_PROGRESS');
  const consultation=await api('read current consultation for journey signature',`/api/visits/${id}/consultation`);
  const encounter=consultation.body.visit.encounters[0];
  const signed=await api('sign while partial medicine remains in pharmacy',`/api/visits/${id}/consultation`,{method:'POST',body:JSON.stringify({action:'SIGN',expectedRevision:`${encounter.id}:${encounter.updatedAt}`,data:{disposition:'OUTPATIENT'}})});
  assert(signed.body.target==='AWAITING_PHARMACY','Signature overlooked in-progress medicine');
  await api('resolve remaining medicine and hand over to billing',`/api/orders/${partial}/dispense`,{method:'POST',body:JSON.stringify({action:'NOT_DISPENSED',idempotencyKey:randomUUID(),notes:'Synthetic remainder resolved with documented clinical handover'})});
  assert((await state()).billing===1 && (await state()).status==='AWAITING_PAYMENT','Signed resolved visit did not enter billing once');
  const invoice=randomUUID();
  await pg.query(`INSERT INTO "Invoice" (id,"visitId","patientId","invoiceNumber","updatedAt") VALUES ($1,$2,$3,'INV-JOURNEY',now())`,[invoice,id,patient.id]);
  await pg.query(`INSERT INTO "InvoiceItem" (id,"invoiceId","serviceCode",description,quantity,"unitPrice") VALUES ($1,$2,'TEST','Synthetic unpaid charge',1,500)`,[randomUUID(),invoice]);
  const path=`/api/visits/${id}/discharge`;
  const review=await api('review discharge against current service records',path);
  const newOrder=await order('IMAGING');
  const input={outcome:'OUTPATIENT',details:'Synthetic follow-up, counselling and handover recorded',cancelPendingOrders:true,expectedRevision:review.body.revision,requestKey:randomUUID()};
  const stale=await requestWithCookie(path,sessionCookie,{method:'POST',body:JSON.stringify(input)});
  assert(stale.response.status===409,'Stale discharge cancelled a newly added order');
  assert((await pg.query('SELECT status FROM "ClinicalOrder" WHERE id=$1',[newOrder])).rows[0].status==='REQUESTED','Stale cancellation changed the order');
  input.expectedRevision=(await api('reload changed discharge review',path)).body.revision;
  await pg.exec(`CREATE FUNCTION reject_journey_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='VISIT_CLINICALLY_CLOSED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_journey_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_journey_audit();`);
  try { assert((await requestWithCookie(path,sessionCookie,{method:'POST',body:JSON.stringify(input)})).response.status===500,'Closure ignored failed audit'); }
  finally { await pg.exec('DROP TRIGGER reject_journey_audit ON "AuditEvent"; DROP FUNCTION reject_journey_audit();'); }
  assert((await state()).status==='AWAITING_PAYMENT','Audit failure left a partial clinical closure');
  const results=await Promise.all([requestWithCookie(path,sessionCookie,{method:'POST',body:JSON.stringify(input)}),requestWithCookie(path,sessionCookie,{method:'POST',body:JSON.stringify(input)})]);
  assert(results.every(result=>result.response.ok),'Concurrent discharge retry did not recover the recorded closure');
  assert(results[0].body.visit.clinicallyClosedAt===results[1].body.visit.clinicallyClosedAt,'Retry changed the clinical closure time');
  assert((await state()).status==='DISCHARGED' && (await state()).billing===1,'Clinical discharge erased unpaid billing work');
  const changed=await requestWithCookie(path,sessionCookie,{method:'POST',body:JSON.stringify({...input,details:'Changed summary cannot reuse this key'})});
  assert(changed.response.status===409,'Closure replay accepted changed details');
  assert((await requestWithCookie(`/api/visits/${id}/complete`,sessionCookie,{method:'POST'})).response.status===409,'Unpaid visit completed');
  // Synthetic fixture settles the charge and uses a corrected signed record.
  await pg.query('UPDATE "InvoiceItem" SET "unitPrice"=0 WHERE "invoiceId"=$1',[invoice]);
  await pg.query(`UPDATE "Encounter" SET status='CORRECTED' WHERE id=$1`,[encounterId]);
  const completions=await Promise.all([requestWithCookie(`/api/visits/${id}/complete`,sessionCookie,{method:'POST'}),requestWithCookie(`/api/visits/${id}/complete`,sessionCookie,{method:'POST'})]);
  assert(completions.every(result=>result.response.ok),'Corrected consultation or completion retry failed');
  assert((await state()).status==='COMPLETED' && (await state()).billing===0,'Administrative completion left billing tasks active');
  const audit=await pg.query(`SELECT action,count(*)::int AS count FROM "AuditEvent" WHERE "entityId"=$1 AND action IN ('VISIT_COMPLETED','VISIT_CLINICALLY_CLOSED') GROUP BY action`,[id]);
  assert(audit.rows.length===2 && audit.rows.every(row=>row.count===1),'Retry duplicated a final transition audit');
  steps.push('verify full parallel-service journey, stale discharge rejection, audit rollback, unpaid closure and exact retry recovery');
}
