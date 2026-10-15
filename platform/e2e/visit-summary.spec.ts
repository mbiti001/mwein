import { expect, test } from "@playwright/test";

test("summary omits untouched assessments and aligns only recorded history and findings", async ({ page }, testInfo) => {
  const summary = {
    id: "layout", visitNumber: "MMS-V-LAYOUT", priority: "ROUTINE", status: "COMPLETED", clinic: "Outpatient", arrivedAt: "2026-10-15T09:00:00Z", facility: { name: "Synthetic clinic", code: "TEST" },
    patient: { fullName: "Summary Layout Reviewer", patientNumber: "TEST-P-001", sexAtBirth: "FEMALE", estimatedAgeYears: 34, allergies: [] },
    encounter: { id: "encounter", status: "SIGNED", clinician: { displayName: "Synthetic Clinician" }, signedAt: "2026-10-15T10:00:00Z", subjective: { chiefComplaint: "Chest pain", symptomDuration: "1", historyPresentingIllness: "Cough", reviewOfSystems: "Fever: Not asked\nFetal movement: Not applicable / not asked", pastMedicalHistory: "  " }, objective: { generalExamination: "General appearance: Not assessed\nHydration: Not assessed\nPallor: Not assessed\nPallor assessment site: Not recorded\nOedema distribution: Not applicable", systemicExamination: "Respiratory effort: Not examined\nBowel sounds: Not auscultated\nAscites: Not assessed" }, diagnoses: [], plan: { plan: "Review documented findings.", disposition: "Home" }, addenda: [] },
    orders: [], referrals: [], invoice: null,
  };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Summary reviewer", email: "reviewer@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["clinical.summary.read"], mustChangePassword: false, mfaRequired: false, mfaEnrolled: false } } }));
  await page.route("**/api/visit-summaries?*", route => route.fulfill({ json: { summaries: [summary] } }));
  const openSummary = async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Patient records", exact: true }).click();
    await page.getByRole("button", { name: /Summary Layout Reviewer/ }).click();
  };
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openSummary();
  const paper = page.locator(".compactVisitSummary");
  await expect(paper.getByRole("heading", { name: "Examination", exact: true })).toHaveCount(0);
  await expect(paper.getByText("Additional history", { exact: true })).toHaveCount(0);
  for (const title of ["Diagnoses", "Medicines", "Investigations"]) await expect(paper.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
  await expect(paper.getByText("Not scheduled", { exact: true })).toHaveCount(0);
  await expect(paper.getByText("Duration (as recorded)")).toBeVisible();
  await expect(paper.locator(".summaryComplaint dd").last()).toHaveText("1");
  const complaintY = await paper.locator(".summaryComplaint > div").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().y));
  expect(new Set(complaintY).size).toBe(1);

  summary.encounter.objective.generalExamination = "General appearance: Well appearing\nHydration: Clinically hydrated\nPallor: Absent\nJaundice: Not assessed\nAdditional findings: Assessment completed with the patient seated.";
  summary.encounter.objective.systemicExamination = "Breath sounds: Vesicular bilaterally\nAdded sounds: None\nJVP: Not elevated\nMurmur: No murmur heard\nLowest MRC muscle power: 0/5\nGait: Not examined due to pain\nBowel sounds: Not auscultated\nAdditional findings: Follow-up examination planned.\nReason: mobility limited by pain.";
  summary.encounter.subjective.reviewOfSystems = "Fever: Denied\nCough: Not asked";
  (summary as any).orders = [{ id: "med", type: "MEDICATION", displayName: "Synthetic medicine", prescription: { genericName: "Synthetic medicine", strength: "Test strength", dosageForm: "Tablet", dose: "Test dose", route: "Test route", frequency: "Test frequency", duration: "Test duration", dispenseStatus: "PENDING", instructions: "" } }];
  await openSummary();
  await expect(paper.locator(".summaryMedicine").getByText("PENDING", { exact: true })).toBeVisible();
  await expect(paper.locator(".summaryMedicine").getByText("Instructions", { exact: true })).toHaveCount(0);
  const exam = paper.locator("section").filter({ has: page.getByRole("heading", { name: "Examination", exact: true }) });
  for (const value of ["Well appearing", "Clinically hydrated", "Absent", "None", "Not elevated", "No murmur heard", "0/5", "Not examined due to pain"]) {
    await expect(exam.getByText(value, { exact: true })).toBeVisible();
  }
  for (const label of ["Jaundice", "Bowel sounds", "Pallor assessment site"]) await expect(exam.getByText(label, { exact: true })).toHaveCount(0);
  await expect(paper.getByText("Synthetic Clinician", { exact: true })).toBeVisible();
  await expect(paper.getByText("SIGNED CLINICAL RECORD")).toBeVisible();
  await expect(paper.getByRole("button", { name: "Add signed addendum" })).toHaveCount(0);
  const firstRowY = await exam.locator(".summaryFactsGrid").first().locator(":scope > div").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().y));
  expect(new Set(firstRowY).size).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("recorded-summary-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".mobileNavToggle")).toBeHidden();
  await expect(paper.getByText("Denied", { exact: true })).toBeVisible();
  await expect(paper.getByText("Follow-up examination planned.\nReason: mobility limited by pain.", { exact: true })).toBeVisible();
  await expect(exam.getByText("Not auscultated", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("recorded-summary-print.png"), fullPage: true, animations: "disabled" });
  await page.pdf({ path: testInfo.outputPath("recorded-summary.pdf"), format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(exam.getByText("Not examined due to pain", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`recorded-summary-${width}.png`), fullPage: true, animations: "disabled" });
  }
});

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
