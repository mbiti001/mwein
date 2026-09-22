import { expect, test } from "@playwright/test";

test("visit summary preserves disclosure content when printing and fits mobile", async ({ page }, testInfo) => {
  await page.route("**/api/visit-summaries?*", route => route.fulfill({ json: { summaries: [{
    id: "preview", visitNumber: "MMS-V-TEST", priority: "ROUTINE", status: "COMPLETED", clinic: "Outpatient", arrivedAt: "2026-09-20T09:00:00Z", facility: { name: "Mwein Medical Services", code: "MMS" },
    patient: { fullName: "Summary Test Patient", patientNumber: "MMS-P-TEST", sexAtBirth: "FEMALE", estimatedAgeYears: 34, allergies: [{ substance: "Penicillin", reaction: "Rash" }] },
    encounter: { id: "encounter", status: "SIGNED", clinician: { displayName: "Test Clinician" }, signedAt: "2026-09-20T10:00:00Z", subjective: { complaints: [{ complaint: "Cough", durationValue: 3, durationUnit: "DAYS" }], historyPresentingIllness: "Persistent cough since Monday.", pastMedicalHistory: "Previous history retained in print." }, objective: { generalExamination: "Alert and comfortable.", systemicExamination: "Chest examination documented." }, diagnoses: [{ id: "d1", primary: true, code: "J06.9", description: "Upper respiratory tract infection", type: "WORKING" }], plan: { plan: "Supportive care and return precautions discussed.", disposition: "Home", followUpDate: "2026-09-27" }, addenda: [] },
    orders: [{ id: "lab1", type: "LABORATORY", displayName: "Full blood count", status: "COMPLETED", laboratory: { result: { status: "VERIFIED", items: [{ id: "r1", analyte: "Haemoglobin", value: "13", unit: "g/dL", referenceRange: "12–16", flag: "Normal" }] } } }], referrals: [], invoice: { invoiceNumber: "INV-TEST", currency: "KES", status: "PAID", items: [{ quantity: 1, unitPrice: 500 }], payments: [{ amount: 500 }] },
  }] } }));
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill("admin@mwein.local");
  await page.getByLabel("Password").fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Patient records", exact: true }).click();
  await page.getByRole("button", { name: /Summary Test Patient/ }).click();
  const paper = page.locator(".compactVisitSummary");
  await expect(paper.getByText("Penicillin — Rash")).toBeVisible();
  await expect(paper.getByText("Haemoglobin", { exact: true })).toBeHidden();
  await expect(paper.getByRole("heading", { name: "Imaging findings" })).toHaveCount(0);
  const labs = paper.locator("details").filter({ has: page.getByRole("heading", { name: "Laboratory findings" }) });
  await labs.locator("summary").click();
  await expect(paper.getByText("Haemoglobin", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("summary-desktop.png"), fullPage: true, animations: "disabled" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await expect(paper.getByText("Previous history retained in print.")).toBeVisible();
  await expect(paper.getByRole("heading", { name: "Laboratory findings" })).toBeVisible();
  await expect(paper.getByText("INV-TEST", { exact: true })).toBeVisible();
  await expect(paper.getByLabel("Reason *", { exact: true })).toBeHidden();
  expect(await labs.locator("summary").evaluate(element => getComputedStyle(element, "::after").display)).toBe("none");
  await page.screenshot({ path: testInfo.outputPath("summary-print.png"), fullPage: true, animations: "disabled" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await expect(paper.getByText("Previous history retained in print.")).toBeHidden();
  await expect(paper.getByText("Haemoglobin", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(paper).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("summary-mobile.png"), fullPage: true, animations: "disabled" });
});
