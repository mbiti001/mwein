import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function login(request: APIRequestContext, email: string, facilityCode = "MMS") {
  const origin = `http://127.0.0.1:${process.env.E2E_APP_PORT || "3210"}`;
  const response = await request.post("/api/auth/login", { headers: { origin }, data: { facilityCode, email, password: "Mwein-E2E-Password-2026!" } });
  expect(response.status()).toBe(200);
  return { origin, cookie: response.headers()["set-cookie"].split(";")[0] };
}

test("document numbers survive concurrent creates, replay, edits, signing and correction without crossing facilities", async ({ request }) => {
  test.setTimeout(60_000);
  const admin = await login(request, "admin@mwein.local"), clinician = await login(request, "clinician@example.test"), other = await login(request, "diagnostic.other@example.test", "OTHER"), reception = await login(request, "reception@example.test");
  async function post(path: string, data: unknown, headers = admin) { const r = await request.post(path, { headers, data }); const body = await r.json(); expect(r.ok(), JSON.stringify(body)).toBe(true); return body; }
  const { patient } = await post("/api/patients", { givenName: "Numbering", familyName: `Synthetic-${randomUUID().slice(0, 8)}`, phone: "+254700000006", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false });
  const { visit } = await post("/api/visits", { patientId: patient.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN", idempotencyKey: randomUUID() });
  const payload = { assessmentDate: "2026-10-16", restFrom: "2026-10-16", restTo: "2026-10-16", recommendation: "Synthetic document numbering verification" };
  const input = { kind: "SICK", visitId: visit.id, payload, requestKey: randomUUID() };
  expect((await request.post("/api/clinic-documents", { headers: reception, data: input })).status()).toBe(403);
  expect((await request.post("/api/clinic-documents", { headers: other, data: input })).status()).toBe(422);
  const pair = await Promise.all([0, 1].map(() => request.post("/api/clinic-documents", { headers: clinician, data: input })));
  expect(pair.map(r => r.status()).sort()).toEqual([200, 201]);
  const [first, replay] = await Promise.all(pair.map(r => r.json()));
  expect(first.document.id).toBe(replay.document.id); expect(first.document.reference).toBe(replay.document.reference);
  expect(first.document.reference).toMatch(/^MMS-SICK-\d{4}-\d{6,}$/); expect(first.document).not.toHaveProperty("creationKey"); expect(first.document).not.toHaveProperty("creationHash");
  expect((await request.post("/api/clinic-documents", { headers: admin, data: input })).status()).toBe(409);
  expect((await request.post("/api/clinic-documents", { headers: clinician, data: { ...input, payload: {} } })).status()).toBe(409);
  const competing = await Promise.all([0, 1].map(() => request.post("/api/clinic-documents", { headers: clinician, data: { ...input, requestKey: randomUUID() } })));
  expect(competing.map(r => r.status())).toEqual([201, 201]);
  const saved = await Promise.all(competing.map(r => r.json()));
  const serials = [first.document, ...saved.map(r => r.document)].map(d => BigInt(d.reference.split("-").at(-1))).sort((a, b) => a < b ? -1 : 1);
  expect(serials[1] - serials[0]).toBe(1n); expect(serials[2] - serials[1]).toBe(1n);
  for (const kind of ["MATERNITY", "DELIVERY", "GATE"]) {
    const record = await post("/api/clinic-documents", { kind, visitId: kind === "DELIVERY" ? null : visit.id, payload: {}, requestKey: randomUUID() });
    expect(record.document.reference).toMatch(new RegExp(`^MMS-${kind}-\\d{4}-\\d{6,}$`));
  }
  const update = await request.patch("/api/clinic-documents", { headers: clinician, data: { id: first.document.id, kind: "SICK", version: 1, action: "SAVE", payload: { ...payload, recommendation: "Synthetic amended draft" } } });
  expect(update.status()).toBe(200);
  const current = (await update.json()).document;
  expect(current.reference).toBe(first.document.reference);
  const afterEdit = await post("/api/clinic-documents", input, clinician); expect(afterEdit.document.id).toBe(current.id); expect(afterEdit.document.version).toBe(2);
  const signature = await request.patch("/api/clinic-documents", { headers: clinician, data: { id: current.id, kind: "SICK", version: current.version, action: "SIGN", attested: true, registration: "SYNTHETIC-TEST" } });
  expect(signature.status()).toBe(200); const signed = (await signature.json()).document;
  const correction = { id: signed.id, kind: "SICK", version: signed.version, action: "CORRECT", reason: "Synthetic correction for serial traceability", requestKey: randomUUID() };
  const corrections = await Promise.all([0, 1].map(() => request.patch("/api/clinic-documents", { headers: clinician, data: correction })));
  expect(corrections.map(r => r.status())).toEqual([200, 200]);
  const corrected = await Promise.all(corrections.map(r => r.json())); expect(corrected[0].document.id).toBe(corrected[1].document.id);
  expect(corrected[0].document.reference).not.toBe(signed.reference); expect(corrected[0].document.previous.reference).toBe(signed.reference); expect(corrected[0].document.revision).toBe(2);
  expect((await request.patch("/api/clinic-documents", { headers: clinician, data: { ...correction, requestKey: randomUUID() } })).status()).toBe(409);
  expect((await request.patch("/api/clinic-documents", { headers: other, data: { ...correction, requestKey: randomUUID() } })).status()).toBe(404);
  const list = await request.get(`/api/clinic-documents?kind=SICK&q=${signed.reference}`, { headers: clinician });
  expect(list.headers()["cache-control"]).toContain("no-store");
  const original = (await list.json()).documents.find((d: any) => d.id === signed.id);
  expect(original.reference).toBe(signed.reference); expect(original.contentHash).toBe(signed.contentHash); expect(original.successor.reference).toBe(corrected[0].document.reference);
  expect((await (await request.get(`/api/clinic-documents?kind=SICK&q=${signed.reference}`, { headers: other })).json()).documents).toEqual([]);
});

test("a lost creation response retries the same number and a failed register refresh stays saved", async ({ page }, info) => {
  const record = { id: randomUUID(), kind: "DELIVERY", reference: "MMS-DELIVERY-2026-000123", status: "DRAFT", revision: 1, version: 1, payload: {}, context: { facilityName: "Synthetic clinic", facilityCode: "MMS", timezone: "Africa/Nairobi" }, signerRoles: [] };
  await page.route("**/api/auth/me", r => r.fulfill({ json: { user: { displayName: "Synthetic reviewer", facility: { name: "Synthetic clinic" }, permissions: ["inventory.receive"], roles: [] } } }));
  let readsFail = false; const bodies: string[] = [];
  await page.route("**/api/clinic-documents**", async route => {
    if (route.request().method() === "POST") {
      bodies.push(route.request().postData()!);
      if (bodies.length === 1) return route.abort("failed");
      readsFail = true; return route.fulfill({ json: { document: record, replayed: true } });
    }
    return route.fulfill(readsFail ? { status: 503, json: { error: "Synthetic register unavailable" } } : { json: { documents: [], truncated: false } });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Clinic forms", exact: true }).click();
  await page.getByLabel("Supplier / dispatching department").fill("Synthetic supplier");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry document save" })).toBeVisible();
  await expect(page.getByLabel("Supplier / dispatching department")).toBeDisabled();
  await expect(page.getByRole("button", { name: "New document" })).toBeDisabled();
  await page.getByRole("button", { name: "Retry document save" }).click();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]); expect(JSON.parse(bodies[0]).requestKey).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.getByRole("status").filter({ hasText: "confirmed as saved" })).toBeVisible();
  await expect(page.locator(".clinicFormPaper")).toContainText(record.reference);
  readsFail = false; await page.getByRole("button", { name: "Refresh register" }).click(); expect(bodies).toHaveLength(2);
  await page.setViewportSize({ width: 320, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("number-recovery-phone.png"), fullPage: true });
});
