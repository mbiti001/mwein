import { expect, test, type Page } from "@playwright/test";
async function login(page: Page, email: string) { await page.goto("/"); await page.getByLabel("Facility code").fill("MMS"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill("Mwein-E2E-Password-2026!"); await page.getByRole("button", { name: "Sign in securely" }).click(); await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible(); }
async function api(page: Page, url: string, method = "GET", body?: unknown) { return page.evaluate(async ({ url, method, body }) => { const response = await fetch(url, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; }, { url, method, body }); }
for (const partial of [false, true]) test(`Reception ${partial ? "partial" : "complete"} measurements flow into clinical triage without re-entry`, async ({ page, browser }) => {
  await login(page, "shared.user@example.test");
  await expect(page.getByRole("button", { name: "Vitals", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Triage", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Registration", exact: true }).click();
  await page.getByLabel("First name *").fill("Reception"); await page.getByLabel("Surname *").fill(partial ? "Partial Check" : "Vitals Check");
  await page.getByLabel("Estimated age").fill("32"); await page.getByLabel("Sex at birth *").selectOption("MALE");
  await page.getByLabel("Phone *").fill("+254711777222"); await page.getByLabel("Subcounty *").fill("Nambale");
  await page.getByLabel("Consent to treatment *").check(); await page.getByLabel("Consent to electronic record *").check();
  await page.getByRole("button", { name: "Register patient and continue" }).click();
  const savedVisit = page.waitForResponse(r => r.url().endsWith("/api/visits") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Check in patient", exact: true }).click(); const { visit } = await (await savedVisit).json();
  await expect(page.getByRole("heading", { name: partial ? "Vitals · Reception Partial Check" : "Vitals · Reception Vitals Check" })).toBeVisible();
  await expect(page.getByLabel("Temperature °C")).toHaveValue("");
  for (const [label, value] of [["Temperature °C", "37.2"], ["Pulse /min", "84"], ["Respirations /min", "18"], ["BP systolic", "118"], ["BP diastolic", "76"], ["SpO₂ %", "98"], ["Weight kg", "70"]]) if (!partial || label === "Temperature °C") await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save measured vitals", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Vitals saved" })).toBeVisible();
  const measured = (await api(page, `/api/visits/${visit.id}/vitals`)).data.measurements[0];
  expect(measured.values.temperatureC).toBe(37.2);
  const before = (await api(page, "/api/visits")).data.visits.find((v: any) => v.id === visit.id);
  expect(before.status).toBe("AWAITING_TRIAGE"); expect(before.priority).toBe(visit.priority); expect(before.triage).toBeUndefined();
  expect((await api(page, `/api/visits/${visit.id}/triage`, "POST", {})).status).toBe(403);
  expect((await api(page, `/api/visits/${visit.id}/vitals`, "POST", { measuredAt: new Date().toISOString(), values: { temperatureC: 37 }, triageCategory: "ROUTINE" })).status).toBe(422);
  const nurseContext = await browser.newContext(); const nurse = await nurseContext.newPage(); await login(nurse, "nurse@example.test");
  await nurse.getByRole("button", { name: "Triage", exact: true }).click(); await nurse.getByRole("button", { name: partial ? /Reception Partial Check/ : /Reception Vitals Check/ }).click();
  await expect(nurse.getByLabel("Temperature °C")).toHaveValue("37.2");
  await nurse.getByLabel("Pain /10").fill("1"); await nurse.getByLabel("Consciousness").selectOption("ALERT");
  await nurse.getByRole("button", { name: "Use recorded measurements in triage", exact: true }).click();
  await expect(nurse.getByLabel("Pain /10")).toHaveValue("1"); await expect(nurse.getByLabel("Consciousness")).toHaveValue("ALERT");
  await expect(nurse.getByLabel("Temperature °C")).toHaveAttribute("readonly", "");
  if (partial) for (const [label, value] of [["Pulse /min", "84"], ["Respirations /min", "18"], ["BP systolic", "118"], ["BP diastolic", "76"], ["SpO₂ %", "98"], ["Weight kg", "70"]]) await nurse.getByLabel(label).fill(value);
  await expect(nurse.getByLabel("Temperature °C")).toHaveValue("37.2"); await expect(nurse.getByLabel("Weight kg")).toHaveValue("70");
  await nurse.getByLabel("Presenting concern / immediate red flag *").fill("Synthetic visit for workflow review");
  await nurse.getByLabel("Pain /10").fill("1"); await nurse.getByLabel("Consciousness").selectOption("ALERT"); await nurse.getByLabel("Triage category *").selectOption("ROUTINE");
  let lostResponse = false;
  if (partial) await nurse.route(`**/api/visits/${visit.id}/triage`, async route => {
    if (route.request().method() !== "POST" || lostResponse) return route.continue();
    await route.fetch(); lostResponse = true; await route.abort("failed");
  });
  const completed = nurse.waitForResponse(r => r.url().endsWith(`/visits/${visit.id}/triage`) && r.request().method() === "POST");
  await nurse.getByRole("button", { name: "Complete triage", exact: true }).click();
  if (partial) { await expect(nurse.getByRole("button", { name: "Retry same triage save" })).toBeVisible(); await nurse.getByRole("button", { name: "Retry same triage save" }).click(); }
  const result = await (await completed).json(); expect(result.visit.status).toBe("AWAITING_CLINICIAN");
  if (!partial) expect(result.visit.triage.reviewedVitalsId).toBe(measured.id);
  if (partial) expect(result.replayed).toBe(true);
  const history = (await api(page, `/api/visits/${visit.id}/vitals`)).data.measurements;
  expect(history).toHaveLength(partial ? 2 : 1); expect(history.find((record: any) => record.id === measured.id)).toEqual(measured);
  if (partial) { expect(history[0].note).toContain(measured.id); expect(history[0].note).toContain("Added at the completion time"); }
  await nurse.getByRole("button", { name: partial ? /Open Reception Partial Check/ : /Open Reception Vitals Check/ }).click();
  await expect(nurse.getByRole("button", { name: "Complete triage", exact: true })).toHaveCount(0);
  await expect(nurse.getByRole("button", { name: "Save measured vitals", exact: true })).toBeVisible();
  await nurse.getByLabel("Temperature °C").fill("37.3");
  nurse.once("dialog", dialog => dialog.dismiss()); await nurse.getByRole("button", { name: "Back to queue" }).click();
  await expect(nurse.getByLabel("Temperature °C")).toHaveValue("37.3");
  await nurse.getByRole("button", { name: "Save measured vitals", exact: true }).click();
  await expect(nurse.getByRole("status").filter({ hasText: "Vitals saved" })).toBeVisible();
  expect((await api(nurse, `/api/visits/${visit.id}/vitals`)).data.measurements).toHaveLength(partial ? 3 : 2);
  await nurseContext.close();
});
