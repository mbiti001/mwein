export async function verifyPrivacy({ api, requestWithCookie, authenticate, patient, assert, steps, origin }) {
  const path = `/api/patients/${patient.id}/privacy`;
  const created = await api("create verified-export request", path, { method: "POST", body: JSON.stringify({ action: "CREATE_REQUEST", type: "PORTABLE_EXPORT", details: "Synthetic patient requests their portable record" }) });
  const requestId = created.body.record.id;
  assert(new Date(created.body.record.dueAt) - new Date(created.body.record.requestedAt) === 30 * 86400000, "Portability deadline was not calculated from original receipt");
  const dpo = await authenticate("MMS", "privacy@example.test");
  const exportRequest = () => requestWithCookie(`${path}/export`, dpo.cookie, { method: "POST", body: JSON.stringify({ requestId }) });
  assert((await exportRequest()).response.status === 409, "Export bypassed identity verification");
  for (const status of ["IDENTITY_VERIFIED", "IN_REVIEW"]) {
    await api(`move export request to ${status}`, path, { method: "POST", body: JSON.stringify({ action: "UPDATE_REQUEST", requestId, status }) });
  }
  const reception = await authenticate("MMS", "shared.user@example.test");
  assert((await requestWithCookie(path, reception.cookie, { method: "POST", body: JSON.stringify({ action: "CREATE_REQUEST", type: "ACCESS", details: "Unauthorized intake attempt" }) })).response.status === 403, "Reception created a privacy request without permission");
  assert((await requestWithCookie(`${path}/export`, reception.cookie, { method: "POST", body: JSON.stringify({ requestId }) })).response.status === 403, "Reception exported a patient without DPO permission");
  const otherFacility = await authenticate("OTHER", "shared.user@example.test");
  assert(!(await requestWithCookie(path, otherFacility.cookie)).response.ok, "Other facility accessed privacy requests");
  assert(!(await requestWithCookie(path, otherFacility.cookie, { method: "POST", body: JSON.stringify({ action: "CREATE_REQUEST", type: "ACCESS", details: "Foreign facility intake attempt" }) })).response.ok, "Other facility created a privacy request");
  const legacyGet = await fetch(`${origin}${path}/export?requestId=${requestId}`, { headers: { cookie: dpo.cookie } });
  assert(legacyGet.status === 405, "GET still generated a state-changing export");
  const results = await Promise.all([exportRequest(), exportRequest()]);
  assert(results.filter(result => result.response.ok).length === 1 && results.filter(result => result.response.status === 409).length === 1, "Concurrent export was not single-use");
  const exported = results.find(result => result.response.ok);
  assert(exported.body.patient.id === patient.id && exported.response.headers.get("cache-control").includes("no-store"), "Export returned wrong patient or was cacheable");
  const requests = await api("verify export preparation leaves delivery outstanding", path);
  const prepared = requests.body.requests.find(record => record.id === requestId);
  assert(prepared.status === "IN_REVIEW" && !prepared.completedAt && prepared.responseEvidenceReference.startsWith("audit:"), "Export generation incorrectly closed the request");
  const deliver = { action: "CONFIRM_DELIVERY", requestId, responseEvidenceReference: prepared.responseEvidenceReference, recipientKind: "AUTHORIZED_REPRESENTATIVE", recipientReference: "SYNTHETIC-RECIPIENT", identityEvidenceReference: "SYNTHETIC-ID-CHECK", authorityEvidenceReference: "SYNTHETIC-AUTHORITY", method: "IN_PERSON", deliveryEvidenceReference: "SYNTHETIC-RECEIPT", resolution: "Reviewed synthetic response received by verified representative", attested: true };
  const send = (body, cookie = dpo.cookie) => requestWithCookie(path, cookie, { method: "POST", body: JSON.stringify(body) });
  assert((await send({ action: "UPDATE_REQUEST", requestId, status: "COMPLETED", resolution: "Attempt to skip delivery", evidenceReference: "SYNTHETIC" })).response.status === 422, "Generic completion bypassed delivery");
  assert((await send({ ...deliver, authorityEvidenceReference: undefined })).response.status === 422, "Representative delivery lacked authority evidence");
  assert((await send(deliver, reception.cookie)).response.status === 403, "Reception recorded delivery without permission");
  assert(!(await send(deliver, otherFacility.cookie)).response.ok, "Other facility recorded delivery");
  const regenerated = await requestWithCookie(`${path}/export`, dpo.cookie, { method: "POST", body: JSON.stringify({ requestId, previousResponseReference: prepared.responseEvidenceReference, regenerationReason: "Synthetic download recovery after lost response" }) });
  assert(regenerated.response.ok, "Reviewed export regeneration failed");
  assert((await send(deliver)).response.status === 409, "Stale prepared response was confirmed as delivered");
  const refreshed = await api("review regenerated export evidence", path);
  const current = refreshed.body.requests.find(record => record.id === requestId);
  deliver.responseEvidenceReference = current.responseEvidenceReference;
  const confirmations = await Promise.all([send(deliver), send(deliver)]);
  assert(confirmations.filter(result => result.response.ok).length === 1 && confirmations.filter(result => result.response.status === 409).length === 1, "Concurrent delivery confirmations both succeeded");
  const final = await api("verify retained response delivery evidence", path);
  const completed = final.body.requests.find(record => record.id === requestId);
  assert(completed.status === "COMPLETED" && completed.deliveryEvidence.authorityEvidenceReference === deliver.authorityEvidenceReference && completed.responseEvidenceReference === current.responseEvidenceReference && completed.dueAt === prepared.dueAt, "Delivery lost evidence or changed the response clock");
  assert((await exportRequest()).response.status === 409, "Completed response was exported again");
  steps.push("verify export role/identity checks, preparation, regeneration, stale/concurrent delivery and retained evidence");
}
