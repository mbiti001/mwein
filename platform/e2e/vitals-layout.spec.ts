import { test, expect } from "@playwright/test";

test("recorded vitals align across the page and keep missing values and attribution clear on phones", async ({ page }, testInfo) => {
  const visit = { id: "layout-visit", visitNumber: "V-LAYOUT", clinic: "Outpatient", status: "AWAITING_TRIAGE", priority: "ROUTINE", arrivedAt: new Date().toISOString(), patient: { id: "layout-patient", fullName: "Synthetic Layout Patient", patientNumber: "P-LAYOUT", sexAtBirth: "UNKNOWN" } };
  const measurements = [
    { id: "latest", measuredAt: "2026-09-25T09:19:00.000Z", recordedAt: "2026-09-25T09:20:00.000Z", recordedBy: { displayName: "Synthetic Nurse A" }, values: { temperatureC: 37.2, pulseBpm: 84, respiratoryRate: 18, systolicBp: 118, diastolicBp: 76, oxygenSaturation: 98, weightKg: 70, heightCm: 172 }, note: null },
    { id: "earlier", measuredAt: "2026-09-25T09:17:00.000Z", recordedAt: "2026-09-25T09:18:00.000Z", recordedBy: { displayName: "Synthetic Nurse B" }, values: { temperatureC: 37.1, pulseBpm: 82, respiratoryRate: 18, systolicBp: 116, diastolicBp: 74, oxygenSaturation: 98, weightKg: 70 }, note: "Height was not measured in this set." },
  ];
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Layout reviewer", email: "reviewer@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["visit.read", "vitals.write"], mustChangePassword: false, mfaRequired: false, mfaEnrolled: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [visit] } }));
  await page.route("**/api/visits/layout-visit/vitals", route => route.fulfill({ json: { measurements, truncated: false } }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Triage", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic Layout Patient/ }).click();
  const panel = page.getByRole("region", { name: "Recorded vital measurements" });
  const sets = panel.locator(".measurementSet");
  await expect(sets).toHaveCount(2);
  await expect(sets.first()).toContainText("25/09/2026, 12:19:00");
  await expect(sets.last()).toContainText("Recorded by Synthetic Nurse B");
  await expect(sets.last().locator(".measurementValues>div").filter({ hasText: "Height cm" })).toContainText("Not recorded");
  const cells = sets.first().locator(".measurementValues>div");
  await expect(cells).toHaveCount(8);
  const positions = await cells.evaluateAll(elements => elements.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })));
  expect(new Set(positions.map(p => p.y)).size).toBe(1);
  expect(positions.at(-1)!.x).toBeGreaterThan(positions[0].x);
  const inputRows = await panel.locator(".vitalGrid>label").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().y));
  expect(inputRows).toHaveLength(8);
  expect(new Set(inputRows).size).toBe(1);
  await panel.screenshot({ path: testInfo.outputPath("vitals-horizontal-desktop.png") });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await sets.last().scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(sets.last()).toContainText("Not recorded");
    await page.screenshot({ path: testInfo.outputPath(`vitals-horizontal-${width}.png`), animations: "disabled" });
  }
});
