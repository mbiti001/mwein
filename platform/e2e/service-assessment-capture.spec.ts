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
  const visitId = await page.evaluate(async familyName => {
    const post = async (url: string, data: object) => {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error(`Synthetic setup failed: ${url} ${response.status} ${await response.text()}`);
      return response.json();
    };
    const { patient } = await post("/api/patients", { givenName: "Capture", familyName, estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", phone: "+254700099077", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false });
    const { visit } = await post("/api/visits", { patientId: patient.id, clinic: "Walk-in", priority: "ROUTINE", visitType: "WALK_IN" });
    return visit.id;
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
  let recordId = "";
  const save = async (text: string) => {
    await plan.fill(text);
    const response = page.waitForResponse(r => r.url().endsWith("/api/service-points") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Save Walk-in assessment", exact: true }).click();
    const saved = await response;
    expect(saved.status()).toBe(200);
    const body = await saved.json();
    recordId = body.record.id;
    expect(body.record.data.carePlan).toBe(text);
    await expect(page.locator(".savedAssessment")).toContainText(text);
    return body.capturedRevision;
  };
  const first = await save("Synthetic browser original plan");
  expect(first.version).toBe(1);
  const second = await save("Synthetic browser reviewed plan");
  expect(second.version).toBe(2);
  expect(second.id).not.toBe(first.id);
  const historyPath = `/api/service-points/history?visitId=${visitId}&recordId=${recordId}`;
  // Use the real browser cookie path, including its secure loopback handling.
  // Playwright's separate APIRequestContext does not reproduce that behavior.
  const readHistory = (url: string) => page.evaluate(async url => {
    const response = await fetch(url);
    return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() };
  }, url);
  const historyResponse = await readHistory(historyPath);
  expect(historyResponse.status).toBe(200);
  expect(historyResponse.cacheControl).toBe("private, no-store");
  const history = historyResponse.body;
  expect(history.items.map((item: any) => [item.id, item.version, item.data.carePlan])).toEqual([
    [second.id, 2, "Synthetic browser reviewed plan"], [first.id, 1, "Synthetic browser original plan"],
  ]);
  expect(history.items.every((item: any) => item.recordedBy.displayName && item.sessionAttribution === "RECORDED" && !Object.hasOwn(item, "sessionId"))).toBe(true);
  const olderResponse = await readHistory(historyPath + "&beforeVersion=2");
  expect(olderResponse.status).toBe(200);
  const older = olderResponse.body;
  expect(older.items.map((item: any) => item.id)).toEqual([first.id]);
  expect(older.nextBeforeVersion).toBeNull();
  expect((await readHistory(historyPath + "&beforeVersion=0")).status).toBe(422);
  await open();
  await expect(plan).toHaveValue("Synthetic browser reviewed plan");
  const historyRegion = page.getByRole("region", { name: "Structured assessment history", exact: true });
  await historyRegion.getByRole("button", { name: "Load saved versions" }).click();
  await historyRegion.getByRole("combobox", { name: "Saved version", exact: true }).selectOption(first.id);
  await expect(historyRegion.getByRole("article")).toContainText("Synthetic browser original plan");
  await expect(historyRegion.getByRole("article")).toContainText("Recorded");
  await expect(plan).toHaveValue("Synthetic browser reviewed plan");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".savedAssessment")).toContainText("Synthetic browser reviewed plan");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".savedAssessment")).toBeVisible();
  await expect(plan).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await historyRegion.getByLabel("Use this version for printing").check();
  await page.emulateMedia({ media: "print" });
  await expect(historyRegion).toBeVisible();
  await expect(page.locator(".savedAssessment")).toBeHidden();
  await expect(page.locator(".assessmentAddenda")).toBeHidden();
  await expect(historyRegion.getByRole("article")).toContainText("Synthetic browser original plan");
  await page.emulateMedia({ media: "screen" });
  await page.context().clearCookies();
  const signedOut = await readHistory(historyPath);
  expect(signedOut.status).toBe(401);
  expect(signedOut.body).not.toHaveProperty("items");
  await historyRegion.getByRole("button", { name: "Reload latest history" }).click();
  await expect(historyRegion).toContainText("Structured history unavailable");
  await expect(historyRegion.getByRole("article")).toHaveCount(0);
  await expect(page.locator(".historyPrintSelected")).toHaveCount(0);
});
