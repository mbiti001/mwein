import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function login(request: APIRequestContext, email: string, facilityCode = "MMS") {
  const origin = `http://127.0.0.1:${process.env.E2E_APP_PORT || "3210"}`;
  const response = await request.post("/api/auth/login", { headers: { origin }, data: { facilityCode, email, password: "Mwein-E2E-Password-2026!" } });
  expect(response.status()).toBe(200);
  return { origin, cookie: response.headers()["set-cookie"].split(";")[0] };
}

test("queue and supply access retains facility boundaries and persisted audit evidence", async ({ request }) => {
  test.setTimeout(60_000);
  const admin = await login(request, "admin@mwein.local"), reception = await login(request, "reception@example.test");
  const foreign = await login(request, "diagnostic.other@example.test", "OTHER"), foreignSupply = await login(request, "supply@example.test", "OTHER");
  async function get(path: string, headers = admin) {
    const response = await request.get(path, { headers }); expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store"); return response.json();
  }
  async function post(path: string, data: unknown) {
    const response = await request.post(path, { headers: admin, data }); const body = await response.json();
    expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  }
  const me = (await get("/api/auth/me")).user;
  expect((await get("/api/auth/me", foreign)).user.permissions).toContain("encounter.write");
  expect((await get("/api/auth/me", foreignSupply)).user.permissions).toContain("inventory.view");
  for (const path of ["/api/queues", "/api/supply/documents"]) expect((await request.get(path, { headers: { cookie: "" } })).status()).toBe(401);
  const { patient } = await post("/api/patients", { givenName: "Operations", familyName: `Synthetic-${randomUUID().slice(0,8)}`, estimatedAgeYears: 31, sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false });
  const { visit } = await post("/api/visits", { patientId: patient.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN", idempotencyKey: randomUUID() });
  const queue = (await get("/api/queues")).entries.find((row: any) => row.visit.id === visit.id);
  expect(queue?.servicePoint).toBe("TRIAGE");
  expect((await get("/api/queues", foreign)).entries.some((row: any) => row.id === queue.id)).toBe(false);
  const start = { action: "START", queueEntryId: queue.id };
  expect((await request.post("/api/queues", { headers: foreign, data: start })).status()).toBe(404);
  expect((await request.post("/api/queues", { headers: reception, data: start })).status()).toBe(403);
  expect((await get("/api/queues")).entries.find((row: any) => row.id === queue.id).status).toBe("WAITING");
  await post("/api/queues", start);
  const reason = `Synthetic operations audit ${randomUUID()}`;
  await post("/api/queues", { action: "ESCALATE", queueEntryId: queue.id, reason });
  await post("/api/queues", { action: "TRANSFER", queueEntryId: queue.id, targetServicePoint: "CONSULTATION", reason });
  const after = await get("/api/queues");
  const destinations = after.entries.filter((row: any) => row.visit.id === visit.id);
  expect(destinations).toHaveLength(1); expect(destinations[0]).toMatchObject({ servicePoint: "CONSULTATION", status: "WAITING", priority: "ROUTINE" });
  // The foreign clinician has permission for this destination service, so this
  // rejection exercises facility isolation independently of service permission.
  expect((await request.post("/api/queues", { headers: foreign, data: { action: "START", queueEntryId: destinations[0].id } })).status()).toBe(404);
  expect(after.history.find((row: any) => row.id === queue.id)?.status).toBe("TRANSFERRED");
  expect((await request.post("/api/queues", { headers: admin, data: { action: "TRANSFER", queueEntryId: queue.id, targetServicePoint: "CONSULTATION", reason } })).status()).toBe(409);
  const documents = (await get("/api/supply/documents")).documents;
  expect(documents.length).toBeGreaterThan(0);
  expect((await get("/api/supply/documents", foreignSupply)).documents).toEqual([]);
  expect((await request.get("/api/supply/documents", { headers: reception })).status()).toBe(403);
  for (const kind of ["PURCHASE_ORDER", "GOODS_RECEIPT"]) {
    const document = documents.find((row: any) => row.kind === kind); expect(document).toBeTruthy();
    const input = { kind, id: document.id, intent: "PRINT" };
    expect((await request.post("/api/supply/documents", { headers: foreignSupply, data: input })).status()).toBe(404);
    expect((await request.post("/api/supply/documents", { headers: reception, data: input })).status()).toBe(403);
    const preview = await post("/api/supply/documents", { ...input, intent: "PREVIEW" });
    expect((await post("/api/supply/documents", input)).document).toEqual(preview.document);
  }
  const audit = await get("/api/admin/audit/export"); expect(audit.chain.valid).toBe(true);
  for (const action of ["QUEUE_REVIEW_ESCALATED", "QUEUE_PATIENT_TRANSFERRED"]) {
    const events = audit.events.filter((row: any) => row.action === action && row.entityId === visit.id && row.reason === reason);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ userId: me.id, facilityId: me.facilityId });
    if (action === "QUEUE_REVIEW_ESCALATED") expect(events[0].sessionId).toBeTruthy();
    else expect(events[0]).toMatchObject({ beforeHash: "TRIAGE", afterHash: "CONSULTATION" });
  }
  for (const context of ["QUEUES", "OPERATIONS_READ:supply-documents", "OPERATIONS_READ:supply-document-preview", "OPERATIONS_READ:supply-document-print"]) {
    const events = audit.events.filter((row: any) => row.reason === context && row.userId === me.id);
    expect(events.length).toBeGreaterThan(0); expect(events.every((row: any) => row.sessionId && row.facilityId === me.facilityId)).toBe(true);
  }
});

test("failed supply refresh or print removes stale content and never prints after rejection", async ({ page }) => {
  const record = { version: 1, kind: "PURCHASE_ORDER", reference: "TEST-PO-ACCESS", status: "DRAFT", facilityName: "Synthetic clinic", facilityCode: "TEST", date: "2026-10-16T08:00:00Z", supplier: { name: "Synthetic supplier", code: "TEST", phone: null, email: null }, orderNumber: "TEST-PO-ACCESS", expectedAt: null, notes: null, cancellationReason: null, actors: [], lines: [], total: null };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Synthetic operator", facility: { name: "Synthetic clinic" }, permissions: ["inventory.view"], roles: [] } } }));
  let failList = false, failPrint = false; const intents: string[] = [];
  await page.route("**/api/supply/documents", route => {
    if (route.request().method() === "POST") {
      const { intent } = route.request().postDataJSON(); intents.push(intent);
      return route.fulfill(failPrint && intent === "PRINT" ? { status: 503, json: { error: "Synthetic print audit unavailable" } } : { json: { document: record } });
    }
    return route.fulfill(failList ? { status: 503, json: { error: "Synthetic register unavailable" } } : { json: { documents: [{ id: "synthetic", ...record, supplierName: record.supplier.name }], truncated: false } });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Pharmacy & stock", exact: true }).click();
  await page.getByRole("button", { name: "Supply documents", exact: true }).click();
  await page.getByLabel("Search documents").fill("TEST-PO");
  await page.getByRole("button", { name: `View ${record.reference}` }).click();
  await expect(page.locator(".supplyDocumentPaper")).toBeVisible();
  await page.evaluate(() => { (window as any).printCalls = 0; window.print = () => { (window as any).printCalls++; }; });
  failPrint = true; await page.getByRole("button", { name: "Print / Save PDF" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Synthetic print audit unavailable");
  await expect(page.locator(".supplyDocumentPaper")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).printCalls)).toBe(0);
  failList = true; await page.getByRole("button", { name: "Refresh documents" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Synthetic register unavailable");
  await expect(page.getByRole("button", { name: `View ${record.reference}` })).toHaveCount(0);
  failList = false; await page.getByRole("button", { name: "Refresh documents" }).click();
  await expect(page.getByLabel("Search documents")).toHaveValue("TEST-PO");
  await expect(page.getByRole("button", { name: `View ${record.reference}` })).toBeVisible();
  expect(intents).toEqual(["PREVIEW", "PRINT"]);
});

test("queue refresh failure removes stale actions and preserves service context across screen sizes", async ({ page }, info) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Synthetic queue operator", facility: { name: "Synthetic clinic" }, permissions: ["visit.read", "triage.write", "encounter.write"], roles: [] } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [] } }));
  const entry = { id: "synthetic-queue", servicePoint: "CONSULTATION", status: "WAITING", priority: "ROUTINE", enteredAt: new Date().toISOString(), visit: { id: "synthetic-visit", visitNumber: "TEST-V-001", clinic: "Outpatient", patient: { patientNumber: "TEST-P-001", fullName: "Synthetic Queue Patient" } } };
  let fail = false; const methods: string[] = [];
  await page.route("**/api/queues", route => {
    methods.push(route.request().method());
    return route.fulfill(fail ? { status: 503, json: { error: "Synthetic queue unavailable" } } : { json: { entries: [entry], history: [], controls: ["TRIAGE", "CONSULTATION"].map(servicePoint => ({ servicePoint, paused: false, targetMinutes: 30 })) } });
  });
  await page.goto("/"); const panel = page.locator(".queueOperations");
  await panel.getByRole("button", { name: "CONSULTATION", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(panel).toContainText("TEST-P-001"); await expect(panel).toContainText("TEST-V-001");
    await page.screenshot({ path: info.outputPath(`queue-${width}.png`), fullPage: true });
  }
  fail = true; await panel.getByRole("button", { name: "Refresh queue" }).click();
  await expect(panel.getByRole("alert")).toContainText("Synthetic queue unavailable");
  await expect(panel.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Call next patient" })).toBeDisabled();
  fail = false; await panel.getByRole("button", { name: "Refresh queue" }).click();
  await expect(panel.getByRole("button", { name: "CONSULTATION", exact: true })).toHaveClass("active");
  await expect(panel.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  expect(methods.every(method => method === "GET")).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(panel).toContainText("TEST-P-001");
  await page.screenshot({ path: info.outputPath("queue-print.png"), fullPage: true });
});
