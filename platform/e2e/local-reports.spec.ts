import { expect, test, type Page } from "@playwright/test";
async function login(page: Page, email: string) {
  await page.goto("/"); await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
}
async function api(page: Page, method: string, body?: unknown) {
  return page.evaluate(async ({ method, body }) => {
    const response = await fetch("/api/reports/local?month=2026-09", { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }, { method, body });
}
test("local reports preserve review, frozen approval and correction history", async ({ page, browser }) => {
  await login(page, "facility.admin@example.test");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  const panel = page.locator(".localReporting");
  await expect(panel.getByRole("heading", { name: "Local reporting drafts" })).toBeVisible();
  await panel.getByLabel("Local reporting month").fill("2026-09");
  await panel.getByLabel("Source reference", { exact: true }).fill("Synthetic September register");
  await panel.getByLabel("Indicator 1", { exact: true }).fill("Local visit count");
  await panel.getByRole("button", { name: "Save local draft", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Revision 1 · DRAFT" })).toBeVisible();
  await panel.getByLabel("Reason or review note").fill("Review source totals");
  await panel.getByRole("button", { name: "Request review", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Missing counts");
  await panel.getByLabel("Count 1", { exact: true }).fill("8");
  await panel.getByRole("button", { name: "Save draft changes", exact: true }).click();
  await expect(panel.getByLabel("Reason or review note")).toHaveValue("");
  await panel.getByLabel("Reason or review note").fill("Counts reconciled");
  await panel.getByRole("button", { name: "Request review", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Revision 1 · IN REVIEW" })).toBeVisible();
  await expect(panel.getByLabel("Count 1", { exact: true })).toBeDisabled();
  let record = (await api(page, "GET")).data.reports.find((r: any) => r.payload.sourceReference === "Synthetic September register");
  expect((await api(page, "PATCH", { id: record.id, version: record.version, action: "APPROVE", reason: "Cannot approve as preparer" })).status).toBe(403);

  const context = await browser.newContext(); const reviewer = await context.newPage();
  await login(reviewer, "medical.director@example.test");
  await reviewer.getByRole("button", { name: "Reports", exact: true }).click();
  const reviewPanel = reviewer.locator(".localReporting");
  await reviewPanel.getByLabel("Local reporting month").fill("2026-09");
  await reviewPanel.getByRole("button", { name: /Synthetic September register · Revision 1/ }).click();
  await reviewPanel.getByLabel("Reason or review note").fill("Recheck source reference");
  await reviewPanel.getByRole("button", { name: "Return for correction", exact: true }).click();
  await expect(reviewPanel.getByRole("heading", { name: "Revision 1 · DRAFT" })).toBeVisible();
  record = (await api(page, "GET")).data.reports.find((r: any) => r.id === record.id);
  const change = { id: record.id, version: record.version, action: "SAVE", reason: "Reconciled source", payload: record.payload };
  const concurrent = await Promise.all([api(page, "PATCH", change), api(page, "PATCH", change)]);
  expect(concurrent.map(r => r.status).sort()).toEqual([200, 409]);
  record = concurrent.find(r => r.status === 200)!.data.report;
  record = (await api(page, "PATCH", { id: record.id, version: record.version, action: "REQUEST_REVIEW", reason: "Ready again" })).data.report;
  await reviewPanel.getByRole("button", { name: "Refresh reports", exact: true }).click();
  await reviewPanel.getByRole("button", { name: /Synthetic September register · Revision 1/ }).click();
  await reviewPanel.getByLabel("Reason or review note").fill("Independently reconciled eight visits");
  await reviewPanel.getByRole("button", { name: "Approve local revision", exact: true }).click();
  await expect(reviewPanel.getByRole("heading", { name: "Revision 1 · APPROVED" })).toBeVisible();
  await expect(reviewPanel.getByRole("status").filter({ hasText: "Nothing has been submitted" })).toBeVisible();
  const approved = (await api(page, "GET")).data.reports.find((r: any) => r.id === record.id);
  expect((await api(page, "PATCH", { ...change, version: approved.version })).status).toBe(409);
  const correctionInput = { id: approved.id, version: approved.version, action: "CORRECT", reason: "Late source reconciliation" };
  const correction = await api(page, "PATCH", correctionInput);
  expect(correction.status).toBe(200); expect(correction.data.report.previousId).toBe(approved.id);
  expect(correction.data.report.revision).toBe(2); expect(correction.data.report.status).toBe("DRAFT");
  expect((await api(page, "PATCH", correctionInput)).status).toBe(409);
  const historical = (await api(page, "GET")).data.reports.find((r: any) => r.id === approved.id);
  expect(historical.payloadHash).toBe(approved.payloadHash); expect(historical.payload).toEqual(approved.payload);
  expect(historical.reviewNote).toBe("Independently reconciled eight visits");
  // A medical director has review permission, but cannot approve a revision they prepared.
  const own = (await api(reviewer, "POST", { month: "2026-09", payload: approved.payload })).data.report;
  const inReview = (await api(reviewer, "PATCH", { id: own.id, version: own.version, action: "REQUEST_REVIEW", reason: "Own draft" })).data.report;
  expect((await api(reviewer, "PATCH", { id: own.id, version: inReview.version, action: "APPROVE", reason: "Self approval" })).status).toBe(403);
  await context.close();
});
test("finance cannot read or prepare local clinical reports", async ({ page }) => {
  await login(page, "finance.manager@example.test");
  expect((await api(page, "GET")).status).toBe(403);
  expect((await api(page, "POST", { month: "2026-09", payload: { sourceReference: "Unauthorized", zeroConfirmed: false, rows: [{ indicator: "Visits", count: 1 }] } })).status).toBe(403);
});
