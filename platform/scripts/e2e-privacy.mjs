export async function verifyPrivacy({ api, requestWithCookie, authenticate, patient, assert, steps, origin }) {
  const path = `/api/patients/${patient.id}/privacy`;
  const created = await api("create verified-export request", path, { method: "POST", body: JSON.stringify({ action: "CREATE_REQUEST", type: "PORTABLE_EXPORT", details: "Synthetic patient requests their portable record", dueAt: new Date(Date.now() + 86400000).toISOString() }) });
  const requestId = created.body.record.id;
  const dpo = await authenticate("MMS", "privacy@example.test");
  const exportRequest = () => requestWithCookie(`${path}/export`, dpo.cookie, { method: "POST", body: JSON.stringify({ requestId }) });
  assert((await exportRequest()).response.status === 409, "Export bypassed identity verification");
  for (const status of ["IDENTITY_VERIFIED", "IN_REVIEW"]) {
    await api(`move export request to ${status}`, path, { method: "POST", body: JSON.stringify({ action: "UPDATE_REQUEST", requestId, status }) });
  }
  const reception = await authenticate("MMS", "shared.user@example.test");
  assert((await requestWithCookie(`${path}/export`, reception.cookie, { method: "POST", body: JSON.stringify({ requestId }) })).response.status === 403, "Reception exported a patient without DPO permission");
  const otherFacility = await authenticate("OTHER", "shared.user@example.test");
  assert(!(await requestWithCookie(path, otherFacility.cookie)).response.ok, "Other facility accessed privacy requests");
  const legacyGet = await fetch(`${origin}${path}/export?requestId=${requestId}`, { headers: { cookie: dpo.cookie } });
  assert(legacyGet.status === 405, "GET still generated a state-changing export");
  const results = await Promise.all([exportRequest(), exportRequest()]);
  assert(results.filter(result => result.response.ok).length === 1 && results.filter(result => result.response.status === 409).length === 1, "Concurrent export was not single-use");
  const exported = results.find(result => result.response.ok);
  assert(exported.body.patient.id === patient.id && exported.response.headers.get("cache-control").includes("no-store"), "Export returned wrong patient or was cacheable");
  const requests = await api("verify export completion evidence", path);
  const completed = requests.body.requests.find(record => record.id === requestId);
  assert(completed.status === "COMPLETED" && completed.evidenceReference.startsWith("audit:"), "Export completion omitted retained audit evidence");
  steps.push("verify export role and identity checks, GET rejection, concurrent single-use and completion evidence");
}
