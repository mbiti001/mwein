import { expect, test, type Page } from "@playwright/test";
async function login(page: Page, email: string) { await page.goto("/"); await page.getByLabel("Facility code").fill("MMS"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill("Mwein-E2E-Password-2026!"); await page.getByRole("button", { name: "Sign in securely" }).click(); await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible(); }
async function api(page: Page, url: string, method = "GET", body?: unknown) { return page.evaluate(async ({ url, method, body }) => { const response = await fetch(url, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; }, { url, method, body }); }
test("Reception captures vitals after check-in and nurse reviews them without re-entry", async ({ page, browser }) => {
  await login(page, "shared.user@example.test");
  await expect(page.getByRole("button", { name: "Triage", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Vitals", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Registration", exact: true }).click();
  await page.getByLabel("First name *").fill("Reception"); await page.getByLabel("Surname *").fill("Vitals Check");
  await page.getByLabel("Estimated age").fill("32"); await page.getByLabel("Sex at birth *").selectOption("MALE");
  await page.getByLabel("Phone *").fill("+254711777222"); await page.getByLabel("Subcounty *").fill("Nambale");
  await page.getByLabel("Consent to treatment *").check(); await page.getByLabel("Consent to electronic record *").check();
  await page.getByRole("button", { name: "Register patient and continue" }).click();
  const savedVisit = page.waitForResponse(r => r.url().endsWith("/api/visits") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Check in patient", exact: true }).click(); const { visit } = await (await savedVisit).json();
  await expect(page.getByRole("heading", { name: "Vitals · Reception Vitals Check" })).toBeVisible();
  await expect(page.getByLabel("Temperature °C")).toHaveValue("");
  for (const [label, value] of [["Temperature °C", "37.2"], ["Pulse /min", "84"], ["Respirations /min", "18"], ["BP systolic", "118"], ["BP diastolic", "76"], ["SpO₂ %", "98"], ["Weight kg", "70"]]) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save measured vitals", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Vitals saved" })).toBeVisible();
  const measured = (await api(page, `/api/visits/${visit.id}/vitals`)).data.measurements[0];
  expect(measured.values.temperatureC).toBe(37.2);
  const before = (await api(page, "/api/visits")).data.visits.find((v: any) => v.id === visit.id);
  expect(before.status).toBe("AWAITING_TRIAGE"); expect(before.priority).toBe(visit.priority); expect(before.triage).toBeUndefined();
  expect((await api(page, `/api/visits/${visit.id}/triage`, "POST", {})).status).toBe(403);
  expect((await api(page, `/api/visits/${visit.id}/vitals`, "POST", { measuredAt: new Date().toISOString(), values: { temperatureC: 37 }, triageCategory: "ROUTINE" })).status).toBe(422);
  const nurseContext = await browser.newContext(); const nurse = await nurseContext.newPage(); await login(nurse, "nurse@example.test");
  await nurse.getByRole("button", { name: "Triage", exact: true }).click(); await nurse.getByRole("button", { name: /Reception Vitals Check/ }).click();
  await expect(nurse.getByLabel("Temperature °C")).toHaveValue("");
  await nurse.getByRole("button", { name: "Use recorded measurements in triage", exact: true }).click();
  await expect(nurse.getByLabel("Temperature °C")).toHaveValue("37.2"); await expect(nurse.getByLabel("Weight kg")).toHaveValue("70");
  await nurse.getByLabel("Presenting concern / immediate red flag *").fill("Synthetic visit for workflow review");
  await nurse.getByLabel("Pain /10").fill("1"); await nurse.getByLabel("Consciousness").selectOption("ALERT"); await nurse.getByLabel("Triage category *").selectOption("ROUTINE");
  const completed = nurse.waitForResponse(r => r.url().endsWith(`/visits/${visit.id}/triage`) && r.request().method() === "POST");
  await nurse.getByRole("button", { name: "Complete triage", exact: true }).click();
  const result = await (await completed).json(); expect(result.visit.status).toBe("AWAITING_CLINICIAN"); expect(result.visit.triage.reviewedVitalsId).toBe(measured.id);
  expect((await api(page, `/api/visits/${visit.id}/vitals`)).data.measurements[0].id).toBe(measured.id);
  await nurseContext.close();
});
