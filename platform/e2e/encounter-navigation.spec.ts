import { expect, test, type Page } from "@playwright/test";

async function openEncounter(page: Page) {
  const id = "aaaaa000-1111-4111-8111-000000000002";
  const visit = {
    id, visitNumber: "V-NAV", clinic: "Outpatient", status: "UNDER_CONSULTATION",
    arrivedAt: "2026-11-01T09:00:00Z", priority: "ROUTINE",
    patient: {
      id: "aaaaa000-1111-4111-8111-000000000001", fullName: "Synthetic Navigation",
      patientNumber: "P-NAV", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", allergies: [],
    },
    triage: { triageCategory: "ROUTINE", observations: [] }, encounters: [], orders: [],
  };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: {
    displayName: "Synthetic clinician", facility: { name: "Test clinic", timezone: "Africa/Nairobi" },
    permissions: ["visit.read", "visit.create", "patient.create", "encounter.write", "clinical.history.read"],
    roles: ["RECEPTION", "CLINICIAN"], mustChangePassword: false,
  } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [visit] } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.route("**/api/catalog", route => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/patients/*/history?*", route => route.fulfill({ json: { visits: [], problems: [], timeline: [] } }));
  await page.route("**/api/visits/*/vitals", route => route.fulfill({ json: { measurements: [], truncated: false } }));

  await page.goto("/");
  const reception = page.getByRole("region", { name: "Reception", exact: true });
  await expect(reception.getByRole("button", { name: "Register patient" })).toBeVisible();
  await expect(reception.getByRole("button", { name: "Book appointment" })).toBeVisible();
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic Navigation.*P-NAV/ }).click();
}

test("encounter navigation keeps notes, separates reception and fits a phone", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEncounter(page);
  const sections = page.getByRole("navigation", { name: "Encounter sections" });
  const overview = page.getByRole("complementary", { name: "Patient overview" });
  const complaints = sections.getByRole("button", { name: /complaint/i });
  const prescription = sections.getByRole("button", { name: /prescription/i });
  const history = page.getByLabel(/history of presenting illness/i);
  await expect(sections.getByRole("button", { name: /triage/i })).toBeVisible();
  await expect(overview).toContainText("P-NAV");
  await expect(page.getByRole("button", { name: /^(Registration|Register patient|Book appointment|Appointments)$/i })).toHaveCount(0);

  await complaints.click();
  await history.fill("Unsaved symptom history for this synthetic visit");
  await sections.getByRole("button", { name: /examination/i }).click();
  await expect(page.getByLabel(/abnormal findings \/ additional examination notes/i)).toBeVisible();
  await prescription.click();
  const editor = page.getByRole("group", { name: "Add a medicine" });
  await expect(editor).toBeVisible();
  const [left, center, right] = await Promise.all([sections.boundingBox(), editor.boundingBox(), overview.boundingBox()]);
  expect(left!.x + left!.width).toBeLessThanOrEqual(center!.x + 1);
  expect(center!.x + center!.width).toBeLessThanOrEqual(right!.x + 1);
  await expect(page.getByRole("button", { name: "Save prescription", exact: true })).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("encounter-desktop.png") });
  await complaints.click();
  await expect(history).toHaveValue("Unsaved symptom history for this synthetic visit");

  await page.setViewportSize({ width: 390, height: 844 });
  const openSections = page.getByRole("button", { name: "Encounter sections", exact: true });
  await openSections.click();
  await prescription.click();
  await expect(editor).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await openSections.click();
  await complaints.click();
  await expect(history).toHaveValue("Unsaved symptom history for this synthetic visit");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("encounter-mobile.png") });
});
