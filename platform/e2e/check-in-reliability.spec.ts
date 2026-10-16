import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function setup(request: APIRequestContext) {
  const origin = `http://127.0.0.1:${process.env.E2E_APP_PORT || "3210"}`;
  const login = await request.post("/api/auth/login", { headers: { origin }, data: { facilityCode: "MMS", email: "admin@mwein.local", password: "Mwein-E2E-Password-2026!" } });
  expect(login.ok()).toBe(true);
  // Preserve the fixture's Secure cookie on HTTP loopback for APIRequestContext.
  const cookie = login.headers()["set-cookie"]?.split(";")[0];
  expect(cookie).toBeTruthy();
  const headers = { origin, cookie };
  const registered = await request.post("/api/patients", { headers, data: { givenName: "Checkin", familyName: `Synthetic-${randomUUID().slice(0, 8)}`, phone: "+254700000002", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false } });
  expect(registered.status()).toBe(201);
  return { headers, patient: (await registered.json()).patient };
}

test("concurrent retries confirm one check-in, invoice and queue task", async ({ request }) => {
  const { headers, patient } = await setup(request);
  const data = { idempotencyKey: randomUUID(), patientId: patient.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN" };
  const responses = await Promise.all([request.post("/api/visits", { headers, data }), request.post("/api/visits", { headers, data })]);
  expect(responses.map(response => response.status()).sort()).toEqual([200, 201]);
  const visits = await Promise.all(responses.map(async response => (await response.json()).visit));
  expect(visits[0].id).toBe(visits[1].id);
  const worklist = await (await request.get("/api/visits", { headers })).json();
  const saved = worklist.visits.filter((visit: { patient: { id: string } }) => visit.patient.id === patient.id);
  expect(saved).toHaveLength(1);
  expect(saved[0].queues).toHaveLength(1);
  expect(saved[0].invoice.items).toHaveLength(1);
});

test("concurrent independent check-ins identify the existing visit without another invoice", async ({ request }) => {
  const { headers, patient } = await setup(request);
  const details = { patientId: patient.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN" };
  const responses = await Promise.all([1, 2].map(() => request.post("/api/visits", { headers, data: { ...details, idempotencyKey: randomUUID() } })));
  expect(responses.map(response => response.status()).sort()).toEqual([201, 409]);
  const created = await responses.find(response => response.status() === 201)!.json();
  const conflict = await responses.find(response => response.status() === 409)!.json();
  expect(conflict.details.activeVisit.id).toBe(created.visit.id);
  expect(Object.keys(conflict.details.activeVisit).sort()).toEqual(["clinic", "id", "status", "visitNumber"]);
  const worklist = await (await request.get("/api/visits", { headers })).json();
  const saved = worklist.visits.filter((visit: any) => visit.patient.id === patient.id);
  expect(saved).toHaveLength(1); expect(saved[0].queues).toHaveLength(1); expect(saved[0].invoice.items).toHaveLength(1);
});

test("appointment replay survives cancellation and cannot open another visit or change routing", async ({ request }) => {
  const { headers, patient } = await setup(request);
  const booked = await request.post("/api/appointments", { headers, data: { patientId: patient.id, clinic: "Outpatient", scheduledAt: new Date(Date.now() + 86400000).toISOString() } });
  expect(booked.status()).toBe(201);
  const appointment = (await booked.json()).appointment;
  const data = { idempotencyKey: randomUUID(), patientId: patient.id, appointmentId: appointment.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "APPOINTMENT" };
  const created = await request.post("/api/visits", { headers, data }); expect(created.status()).toBe(201);
  const original = (await created.json()).visit;
  const replay = await request.post("/api/visits", { headers, data }); expect(replay.status()).toBe(200);
  expect((await replay.json()).visit.id).toBe(original.id);
  expect((await request.post("/api/visits", { headers, data: { ...data, priority: "URGENT" } })).status()).toBe(409);
  const cancelled = await request.post(`/api/visits/${original.id}/cancel`, { headers, data: { reasonCode: "CREATED_IN_ERROR", details: "Synthetic retry test cancellation" } });
  expect(cancelled.status()).toBe(200);
  const later = await request.post("/api/visits", { headers, data: { ...data, idempotencyKey: randomUUID(), appointmentId: undefined, visitType: "WALK_IN" } });
  expect(later.status()).toBe(201);
  const laterVisit = (await later.json()).visit;
  const closedReplay = await request.post("/api/visits", { headers, data }); expect(closedReplay.status()).toBe(200);
  expect((await closedReplay.json()).visit).toMatchObject({ id: original.id, status: "CANCELLED" });
  const worklist = await (await request.get("/api/visits", { headers })).json();
  expect(worklist.visits.filter((visit: any) => visit.patient.id === patient.id).map((visit: any) => visit.id)).toEqual([laterVisit.id]);
});

async function registerInBrowser(page: Page) {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email", { exact: true }).fill("admin@mwein.local");
  await page.getByLabel("Password", { exact: true }).fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Registration", exact: true }).click();
  const surname = `Checkin-${randomUUID().slice(0, 8)}`;
  await page.getByLabel("First name *").fill("Synthetic"); await page.getByLabel("Surname *").fill(surname);
  await page.getByLabel("Estimated age").fill("32"); await page.getByLabel("Sex at birth *").selectOption("UNKNOWN");
  await page.getByLabel("Phone *").fill("+254711777222"); await page.getByLabel("County *", { exact: true }).fill("Nairobi"); await page.getByLabel("Subcounty *").fill("Westlands");
  await page.getByLabel("Consent to treatment *").check(); await page.getByLabel("Consent to electronic record *").check();
  const response = page.waitForResponse(response => response.url().endsWith("/api/patients") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Register patient and continue" }).click();
  const patient = (await (await response).json()).patient;
  await expect(page.getByRole("button", { name: "Check in patient", exact: true })).toBeEnabled();
  return patient;
}

async function savedForPatient(page: Page, patientId: string) {
  return page.evaluate(async id => {
    const { visits } = await (await fetch("/api/visits")).json();
    return visits.filter((visit: any) => visit.patient.id === id);
  }, patientId);
}

test("lost confirmation keeps routing locked and retries the exact request, even after a failed retry", async ({ page }, testInfo) => {
  const patient = await registerInBrowser(page);
  const bodies: string[] = []; let originalId = "";
  await page.route("**/api/visits", async route => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) {
      const saved = await route.fetch(); expect(saved.status()).toBe(201);
      originalId = (await saved.json()).visit.id;
      return route.abort("failed");
    }
    if (bodies.length === 2) return route.fulfill({ status: 409, json: { error: "The record changed while it was being saved" } });
    return route.continue();
  });
  await page.getByRole("button", { name: "Check in patient", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The request may have been saved" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Clinic *", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Arrival type *", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Change patient", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("check-in-recovery-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator("#main-navigation").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("check-in-recovery-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Retry same check-in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "still unconfirmed" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Clinic *", exact: true })).toBeDisabled();
  const response = page.waitForResponse(response => response.url().endsWith("/api/visits") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Retry same check-in", exact: true }).click();
  const replay = await response; expect(replay.status()).toBe(200); expect((await replay.json()).visit.id).toBe(originalId);
  expect(bodies).toHaveLength(3); expect(new Set(bodies).size).toBe(1);
  await expect(page.getByRole("heading", { name: patient.fullName, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete triage", exact: true })).toBeVisible();
  const visits = await savedForPatient(page, patient.id);
  expect(visits).toHaveLength(1); expect(visits[0].queues).toHaveLength(1); expect(visits[0].invoice.items).toHaveLength(1);
});

test("a saved check-in remains confirmed when queue refresh fails and recovery sends no second POST", async ({ page }, testInfo) => {
  const patient = await registerInBrowser(page);
  let saved = false, failRefresh = true, posts = 0, visitNumber = "";
  await page.route("**/api/visits", async route => {
    if (route.request().method() === "POST") {
      posts++; const response = await route.fetch(); expect(response.status()).toBe(201);
      visitNumber = (await response.json()).visit.visitNumber; saved = true;
      return route.fulfill({ response });
    }
    if (saved && failRefresh) return route.fulfill({ status: 503, json: { error: "Synthetic queue refresh outage" } });
    return route.continue();
  });
  await page.getByRole("button", { name: "Check in patient", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Check-in saved as" })).toContainText("Refresh the queue to open the saved visit");
  await expect(page.locator(".syncWarning")).toContainText("Live queue updates are paused");
  await expect(page.getByRole("button", { name: "Check in patient", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("check-in-confirmed-refresh-failure.png"), fullPage: true });
  failRefresh = false;
  await page.locator(".syncWarning").getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".syncWarning")).toHaveCount(0);
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Triage", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(patient.fullName) }).click();
  await expect(page.getByRole("heading", { name: patient.fullName, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete triage", exact: true })).toBeVisible();
  const visits = await savedForPatient(page, patient.id);
  expect(visits).toHaveLength(1); expect(visits[0].visitNumber).toBe(visitNumber);
});

test("a stale check-in form opens a concurrently created visit instead of submitting another", async ({ page }) => {
  const patient = await registerInBrowser(page);
  const result = await page.evaluate(async patientId => {
    const response = await fetch("/api/visits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, idempotencyKey: crypto.randomUUID(), clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN" }) });
    return { status: response.status, data: await response.json() };
  }, patient.id);
  expect(result.status).toBe(201);
  await page.getByRole("button", { name: "Check in patient", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Patient already has an active visit" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Continue the existing visit" })).toContainText(result.data.visit.visitNumber);
  await expect(page.getByRole("button", { name: "Check in patient", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Open existing visit", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "no additional visit or invoice was created" })).toBeVisible();
  expect(await savedForPatient(page, patient.id)).toHaveLength(1);
});
