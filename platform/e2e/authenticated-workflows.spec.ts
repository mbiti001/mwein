import { expect, test, type Page } from "@playwright/test";

const password = "Mwein-E2E-Password-2026!";

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
}

test("renders the tenant-aware staff sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Facility code")).toHaveValue("MMS");
  await expect(page.getByText("Authorised facility staff only. All access is recorded.")).toBeVisible();
});

test("requires a temporary password replacement before opening records", async ({ page }) => {
  await login(page, "temporary@example.test");
  await expect(page.getByRole("heading", { name: "Choose your permanent password" })).toBeVisible();
  await expect(page.getByText("Replace it before opening patient records.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
});

test("loads administration and production release gates after authentication", async ({ page }) => {
  await login(page, "admin@mwein.local");
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
  await page.getByRole("button", { name: "Administration" }).click();
  await expect(page.getByRole("heading", { name: "Facility control centre" })).toBeVisible();
  await page.getByRole("button", { name: "Release gates" }).click();
  await expect(page.getByRole("heading", { name: "Production release gates" })).toBeVisible();
  await expect(page.getByText("0/11")).toBeVisible();
  await expect(page.getByText("Workforce MFA", { exact: true })).toBeVisible();
});

test("keeps a system-administrator-only account in administration", async ({ page }) => {
  await login(page, "system.only@example.test");
  await expect(page.getByRole("button", { name: "Administration" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registration" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Consultation" })).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Find a patient anywhere" })).toHaveCount(0);
});

test("starts triage with blank measured observations and an explicit concern", async ({ page }) => {
  await login(page, "admin@mwein.local");
  await page.getByRole("button", { name: "Registration" }).click();
  await page.getByLabel("First name *").fill("Browser");
  await page.getByLabel("Surname *").fill("Triage Check");
  await page.getByLabel("Estimated age").fill("30");
  await page.getByLabel("Sex at birth *").selectOption("FEMALE");
  await page.getByLabel("Phone *").fill("+254700654321");
  await page.getByLabel("Subcounty *").fill("Teso North");
  await page.getByLabel("Consent to treatment *").check();
  await page.getByLabel("Consent to electronic record *").check();
  await page.getByRole("button", { name: "Register patient and continue" }).click();
  await page.getByRole("button", { name: "Check in patient" }).click();

  await expect(page.getByLabel("Temperature °C")).toHaveValue("");
  await expect(page.getByLabel("Consciousness")).toHaveValue("");
  await expect(page.getByLabel("Triage category *")).toHaveValue("");
  await expect(page.getByLabel("Presenting concern / immediate red flag *")).toBeVisible();
  await expect(page.getByText("No “normal” observations are prefilled.")).toBeVisible();
  await page.getByLabel("Pregnancy status").selectOption("PREGNANT");
  await page.getByLabel("LNMP — first day of last normal menstrual period").fill("2026-01-01");
  await expect(page.getByLabel("Estimated delivery date")).toHaveValue("2026-10-08");
  await expect(page.getByLabel("Gestational age today")).toHaveValue(/\d+ weeks [0-6] days/);
});

test("cancels an undelivered visit with a documented SHA benefit outcome", async ({ page }) => {
  await login(page, "admin@mwein.local");
  await page.getByRole("button", { name: "Registration" }).click();
  await page.getByLabel("First name *").fill("Browser");
  await page.getByLabel("Surname *").fill("Cancellation Check");
  await page.getByLabel("Estimated age").fill("41");
  await page.getByLabel("Sex at birth *").selectOption("MALE");
  await page.getByLabel("Phone *").fill("+254700654399");
  await page.getByLabel("Subcounty *").fill("Teso North");
  await page.getByLabel("Consent to treatment *").check();
  await page.getByLabel("Consent to electronic record *").check();
  await page.getByRole("button", { name: "Register patient and continue" }).click();
  await page.getByRole("button", { name: "Check in patient" }).click();

  await page.getByText("Cancel this visit", { exact: true }).click();
  await page.getByLabel("Cancellation reason").selectOption("SHA_BENEFIT_OR_ELIGIBILITY");
  await expect(page.getByText("must not delay emergency assessment or stabilisation")).toBeVisible();
  await page.getByLabel("SHA outcome").selectOption("BENEFIT_NOT_COVERED");
  await page.getByLabel("SHA check / verification reference").fill("BROWSER-SHA-CHECK-001");
  await page.getByLabel("Cancellation explanation").fill("Routine benefit was unavailable; alternatives and next steps were explained.");
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByText(/was cancelled with a documented reason/)).toBeVisible();
});

test("keeps authenticated navigation usable at a mobile breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "admin@mwein.local");
  const menu = page.getByRole("button", { name: "☰ Menu" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Administration" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("shows WHO-aligned ANC confirmation and adolescent safeguarding controls", async ({ page }) => {
  await login(page, "admin@mwein.local");
  await page.getByRole("button", { name: "Registration" }).click();
  await page.getByLabel("First name *").fill("Browser");
  await page.getByLabel("Surname *").fill("ANC Safety");
  await page.getByLabel("Estimated age").fill("14");
  await page.getByLabel("Sex at birth *").selectOption("FEMALE");
  await page.getByLabel("Phone *").fill("+254711000014");
  await page.getByLabel("Subcounty *").fill("Teso North");
  await page.getByLabel("Consent to treatment *").check();
  await page.getByLabel("Consent to electronic record *").check();
  await page.getByRole("button", { name: "Register patient and continue" }).click();
  await page.getByLabel("Clinic *").selectOption("ANC");
  await expect(page.getByRole("group", { name: "ANC pregnancy confirmation" })).toBeVisible();
  await expect(page.getByText("Confidential safeguarding review required.")).toBeVisible();
  await expect(page.getByText("Do not ask the patient to justify the pregnancy at reception")).toBeVisible();
});

test("blocks senseless ANC counts and alerts on abnormal clinical ranges", async ({ page }) => {
  await login(page, "clinician@example.test");
  await page.getByRole("button", { name: "Service points", exact: true }).click();
  await page.getByRole("button", { name: /^ANC/ }).click();
  await page.getByLabel("Find patient in this queue").fill("Safiya");
  await page.getByRole("button", { name: /Safiya ANC Safety/ }).click();

  const gravida = page.getByLabel("Gravida *");
  await expect(gravida).toHaveAttribute("max", "30");
  await expect(gravida).toHaveAttribute("step", "1");
  await gravida.fill("31");
  await expect(page.getByRole("alert").filter({ hasText: "Cannot save these entries" })).toContainText("Gravida cannot exceed 30");
  await expect(page.getByRole("button", { name: "Resolve entry errors" })).toBeDisabled();

  await gravida.fill("1");
  await page.getByText("Assessment and risk", { exact: true }).click();
  await page.locator("label").filter({ hasText: "Fetal heart rate" }).locator("input").fill("170");
  await expect(page.getByText("Clinical review alert — verify these unusual values")).toBeVisible();
  await expect(page.getByText(/Fetal heart rate outside 110–160 bpm/)).toBeVisible();
});

for (const role of [
  { email: "shared.user@example.test", visible: ["Registration", "Appointments"], hidden: ["Triage", "Consultation", "Billing"] },
  { email: "nurse@example.test", visible: ["Triage"], hidden: ["Registration", "Consultation", "Billing"] },
  { email: "clinician@example.test", visible: ["Consultation", "Service points", "Patient records"], hidden: ["Registration", "Billing", "Administration"] },
  { email: "laboratory@example.test", visible: ["Laboratory"], hidden: ["Consultation", "Pharmacy & stock", "Billing"] },
  { email: "imaging@example.test", visible: ["Imaging"], hidden: ["Laboratory", "Pharmacy & stock", "Billing"] },
  { email: "pharmacy@example.test", visible: ["Pharmacy & stock", "Administration"], hidden: ["Registration", "Consultation", "Billing"] },
  { email: "billing@example.test", visible: ["Billing", "Reports"], hidden: ["Registration", "Consultation", "Pharmacy & stock"] },
  { email: "finance.manager@example.test", visible: ["Billing", "Reports", "Administration"], hidden: ["Registration", "Consultation"] },
  { email: "facility.admin@example.test", visible: ["Billing", "Reports", "Administration"], hidden: ["Registration", "Consultation"] },
] as const) {
  test(`shows only the intended work areas for ${role.email}`, async ({ page }) => {
    await login(page, role.email);
    await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
    for (const label of role.visible) await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    for (const label of role.hidden) await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  });
}

test("lets the medical director govern medication safety without user administration", async ({ page }) => {
  await login(page, "medical.director@example.test");
  await page.getByRole("button", { name: "Administration" }).click();
  await expect(page.getByRole("button", { name: "Medication safety" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Users & access" })).toHaveCount(0);
  await page.getByRole("button", { name: "Medication safety" }).click();
  await expect(page.getByRole("heading", { name: "Medication safety governance" })).toBeVisible();
});

test("shows the new administration workbenches to an authorised administrator", async ({ page }) => {
  await login(page, "facility.admin@example.test");
  await page.getByRole("button", { name: "Administration" }).click();
  await expect(page.getByRole("button", { name: "Data quality" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Operations evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Data quality" }).click();
  await expect(page.getByRole("heading", { name: "Potential duplicate patients" })).toBeVisible();
});

test("completes registration and triage through the browser and routes to consultation", async ({ page }) => {
  await login(page, "admin@mwein.local");
  await page.getByRole("button", { name: "Registration" }).click();
  await page.getByLabel("First name *").fill("Browser");
  await page.getByLabel("Surname *").fill("Full Flow");
  await page.getByLabel("Estimated age").fill("32");
  await page.getByLabel("Sex at birth *").selectOption("MALE");
  await page.getByLabel("Phone *").fill("+254711654322");
  await page.getByLabel("Subcounty *").fill("Teso North");
  await page.getByLabel("Consent to treatment *").check();
  await page.getByLabel("Consent to electronic record *").check();
  await page.getByRole("button", { name: "Register patient and continue" }).click();
  await page.getByRole("button", { name: "Check in patient" }).click();
  await page.getByLabel("Presenting concern / immediate red flag *").fill("Fever for two days");
  await page.getByLabel("Temperature °C").fill("38.1");
  await page.getByLabel("Pulse /min").fill("88");
  await page.getByLabel("Respirations /min").fill("18");
  await page.getByLabel("BP systolic").fill("118");
  await page.getByLabel("BP diastolic").fill("76");
  await page.getByLabel("SpO₂ %").fill("98");
  await page.getByLabel("Weight kg").fill("70");
  await page.getByLabel("Pain /10").fill("2");
  await page.getByLabel("Consciousness").selectOption("ALERT");
  await page.getByLabel("Triage category *").selectOption("ROUTINE");
  await page.getByRole("button", { name: "Complete triage" }).click();
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await expect(page.getByText("Browser Full Flow", { exact: true }).first()).toBeVisible();
});
