import { test, expect } from "@playwright/test";

test("parallel department tasks stay visible, filter independently and fit a phone", async ({ page }) => {
  const now = Date.now();
  const visits = [{ id: "parallel-visit", visitNumber: "V-FLOW-001", clinic: "Outpatient", status: "AWAITING_RESULTS", priority: "ROUTINE", arrivedAt: new Date(now - 60 * 60000).toISOString(),
    patient: { id: "synthetic-patient", fullName: "Parallel Workflow Patient", patientNumber: "P-FLOW", sexAtBirth: "UNKNOWN" },
    queues: [{ servicePoint: "LABORATORY", status: "IN_PROGRESS", enteredAt: new Date(now - 20 * 60000).toISOString() }, { servicePoint: "PHARMACY", status: "WAITING", enteredAt: new Date(now - 5 * 60000).toISOString() }], orders: [] }];
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Workflow tester", email: "test@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["visit.read", "laboratory.write", "pharmacy.dispense"], roles: ["TEST"], mustChangePassword: false, mfaRequired: false, mfaEnrolled: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.goto("/");
  const flow = page.getByRole("region", { name: "Clinic flow", exact: true });
  await expect(flow.locator(".taskRow")).toHaveCount(2);
  await expect(flow.getByRole("button", { name: /^Laboratory 1$/ })).toBeVisible();
  await flow.getByRole("button", { name: /^Pharmacy 1$/ }).click();
  await expect(flow.locator(".taskRow")).toHaveCount(1);
  await expect(flow.locator(".taskRow")).toContainText("Dispense");
  await expect(flow.locator(".taskRow")).toContainText("5 min at Pharmacy");
  await expect(flow.getByRole("button", { name: /^Pharmacy 1$/ })).toHaveAttribute("aria-pressed", "true");
  await flow.getByRole("button", { name: /^All my departments 2$/ }).click();
  await flow.getByRole("searchbox", { name: "Find a task" }).fill("V-FLOW-001");
  await expect(flow.locator(".taskRow")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator("#main-navigation").evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/mwein-clinic-flow-mobile.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/mwein-clinic-flow-desktop.png", fullPage: true, animations: "disabled" });
});
