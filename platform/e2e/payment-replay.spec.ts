import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("concurrent payment retries and repeated external references create one receipt", async ({ request }) => {
  const origin = "http://127.0.0.1:3210";
  const login = await request.post("/api/auth/login", { headers: { origin }, data: { facilityCode: "MMS", email: "admin@mwein.local", password: "Mwein-E2E-Password-2026!" } });
  expect(login.ok()).toBe(true);
  // This isolated fixture uses HTTP loopback with production Secure cookies.
  // APIRequestContext does not make Chromium's localhost exception; retain the
  // issued fixture cookie explicitly without changing application cookie policy.
  const cookie = login.headers()["set-cookie"]?.split(";")[0];
  expect(cookie).toBeTruthy();
  const headers = { origin, cookie };
  const registered = await request.post("/api/patients", { headers, data: { givenName: "Replay", familyName: `Synthetic-${randomUUID().slice(0, 8)}`, phone: "+254700000001", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false } });
  expect(registered.status()).toBe(201);
  const patient = (await registered.json()).patient;
  const checkedIn = await request.post("/api/visits", { headers, data: { patientId: patient.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN" } });
  expect(checkedIn.status()).toBe(201);
  const invoice = (await checkedIn.json()).visit.invoice;
  const endpoint = `/api/invoices/${invoice.id}/payments`;
  const data = { idempotencyKey: randomUUID(), method: "MPESA", amount: 10, externalReference: `SYNTHETIC-${randomUUID()}` };
  const responses = await Promise.all([request.post(endpoint, { headers, data }), request.post(endpoint, { headers, data })]);
  expect(responses.map(response => response.status()).sort()).toEqual([200, 201]);
  const receipts = await Promise.all(responses.map(response => response.json()));
  expect(receipts[0]).toEqual(receipts[1]);
  expect(receipts[0].paid).toBe(10);
  const reopened = await request.post(endpoint, { headers, data: { ...data, idempotencyKey: randomUUID() } });
  expect(reopened.status()).toBe(200);
  expect(await reopened.json()).toEqual(receipts[0]);
  const conflict = await request.post(endpoint, { headers, data: { ...data, amount: 11 } });
  expect(conflict.status()).toBe(409);
  const differentKeyConflict = await request.post(endpoint, { headers, data: { ...data, idempotencyKey: randomUUID(), amount: 11 } });
  expect(differentKeyConflict.status()).toBe(409);
  const visits = await (await request.get("/api/visits", { headers })).json();
  const saved = visits.visits.find((visit: { invoice?: { id: string } }) => visit.invoice?.id === invoice.id);
  expect(saved.invoice.payments).toHaveLength(1);
});

test("payment form retries a lost response without recording money twice", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@mwein.local");
  await page.getByLabel("Password", { exact: true }).fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Billing", exact: true }).click();
  await page.getByRole("button", { name: /Safiya ANC Safety.*INV/ }).click();
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Receive payment", exact: true }) });
  await form.getByRole("combobox", { name: "Method *", exact: true }).selectOption("MPESA");
  await form.getByLabel("Amount *", { exact: true }).fill("10");
  const reference = `SYNTHETIC-LOST-${randomUUID()}`;
  await form.getByLabel("Transaction / approval reference").fill(reference);
  let originalPaymentId = "";
  const keys: string[] = [];
  await page.route("**/api/invoices/*/payments", async route => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (keys.length === 1) {
      const saved = await route.fetch();
      expect(saved.status()).toBe(201);
      originalPaymentId = (await saved.json()).payment.id;
      await route.abort("failed");
    } else await route.continue();
  });
  await form.getByRole("button", { name: "Record payment & issue receipt" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not reach the server" })).toBeVisible();
  await expect(form.getByLabel("Transaction / approval reference")).toHaveValue(reference);
  const replayResponse = page.waitForResponse(response => response.url().endsWith("/payments") && response.request().method() === "POST");
  await form.getByRole("button", { name: "Record payment & issue receipt" }).click();
  const replay = await replayResponse;
  expect(replay.status()).toBe(200);
  expect((await replay.json()).payment.id).toBe(originalPaymentId);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(page.getByRole("button", { name: "Print receipt", exact: true })).toBeVisible();
  const payments = await page.evaluate(async reference => {
    const { visits } = await (await fetch("/api/visits")).json();
    return visits.flatMap((visit: { invoice?: { payments?: { externalReference?: string }[] } }) => visit.invoice?.payments || []).filter((payment: { externalReference?: string }) => payment.externalReference === reference).length;
  }, reference);
  expect(payments).toBe(1);
});
