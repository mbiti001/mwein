import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Real browser/API fixture; the native workflow independently checks retained rows.
test("browser saves capture successive revisions and reload the persisted assessment", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@mwein.local");
  await page.getByLabel("Password", { exact: true }).fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("button", { name: "Service points", exact: true })).toBeVisible();
  // Let initial audited dashboard reads finish before synthetic setup writes.
  await page.waitForLoadState("networkidle");
  const familyName = `Browser-${randomUUID().slice(0, 8)}`;
  await page.evaluate(async familyName => {
    const post = async (url: string, data: object) => {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error(`Synthetic setup failed: ${url} ${response.status} ${await response.text()}`);
      return response.json();
    };
    const { patient } = await post("/api/patients", { givenName: "Capture", familyName, estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", phone: "+254700099077", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false });
    await post("/api/visits", { patientId: patient.id, clinic: "Walk-in", priority: "ROUTINE", visitType: "WALK_IN" });
  }, familyName);
  const open = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Service points", exact: true }).click();
    await page.locator(".careServiceCard").filter({ has: page.locator("strong", { hasText: /^Walk-in$/ }) }).click();
    await page.getByRole("button", { name: new RegExp(familyName) }).click();
  };
  await open();
  await page.getByRole("combobox", { name: "Service requested *", exact: true }).selectOption("Screening");
  await page.getByLabel("Order, refill or service details").fill("Synthetic browser capture request");
  await page.getByLabel("Identity, allergy, indication and immediate-risk checks").fill("Synthetic browser checks");
  const plan = page.getByLabel("Follow-up, escalation or referral plan");
  const save = async (text: string) => {
    await plan.fill(text);
    const response = page.waitForResponse(r => r.url().endsWith("/api/service-points") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Save Walk-in assessment", exact: true }).click();
    const saved = await response;
    expect(saved.status()).toBe(200);
    const body = await saved.json();
    expect(body.record.data.carePlan).toBe(text);
    await expect(page.locator(".savedAssessment")).toContainText(text);
    return body.capturedRevision;
  };
  const first = await save("Synthetic browser original plan");
  expect(first.version).toBe(1);
  const second = await save("Synthetic browser reviewed plan");
  expect(second.version).toBe(2);
  expect(second.id).not.toBe(first.id);
  await open();
  await expect(plan).toHaveValue("Synthetic browser reviewed plan");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".savedAssessment")).toContainText("Synthetic browser reviewed plan");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".savedAssessment")).toBeVisible();
  await expect(plan).toBeHidden();
});
