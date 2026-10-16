import { test, expect, type Page } from "@playwright/test";

// Synthetic response fixtures verify presentation and unchanged request contracts.
// Persisted authorization/audit behavior is covered separately by API tests.
const patient = { fullName: "Synthetic Long Patient Name For Workflow Layout", patientNumber: "TEST-P-00001" };
const entry = { id: "queue-one", servicePoint: "TRIAGE", priority: "URGENT", status: "WAITING", enteredAt: new Date(Date.now() - 60 * 60_000).toISOString(), visit: { id: "visit-one", visitNumber: "TEST-V-00001", patient } };
const controls = ["TRIAGE", "CONSULTATION"].map(servicePoint => ({ servicePoint, paused: false, targetMinutes: 30 }));
async function fixture(page: Page, permissions = ["visit.read", "triage.write", "encounter.write", "visit.create", "clinical.summary.read", "referral.read"]) {
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { error: "Unmocked API disabled for layout test" } }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Synthetic operator", facility: { name: "Synthetic clinic" }, permissions, roles: [] } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [] } }));
}

test("queue tables preserve identity, labelled phone actions, history limits and clean print", async ({ page }, info) => {
  await fixture(page);
  const writes: unknown[] = [];
  await page.route("**/api/queues", route => {
    if (route.request().method() === "POST") { writes.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { entries: [entry], controls, history: Array.from({ length: 21 }, (_, i) => ({ ...entry, id: `history-${i}`, status: "TRANSFERRED", durationMinutes: i ? 0 : undefined })) } });
  });
  await page.goto("/");
  const panel = page.locator(".queueOperations"), table = panel.getByRole("table").first();
  await expect(table.getByRole("rowheader")).toContainText("TEST-V-00001");
  await expect(table).toContainText("OVERDUE");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await table.getByRole("button", { name: "Transfer", exact: true }).click();
    await expect(table.getByLabel("Transfer destination")).toBeVisible();
    await expect(table.getByLabel("Transfer reason")).toBeVisible();
    const bounds = await table.getByLabel("Transfer destination").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    if (width <= 768) {
      await expect(table.getByRole("cell", { name: /Time in queue/ })).toBeVisible();
      expect(await table.getByRole("cell").nth(1).evaluate(el => getComputedStyle(el, "::before").content)).toBe('"Time in queue"');
      expect((await table.getByRole("button", { name: "Transfer", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await table.getByRole("button", { name: "Transfer", exact: true }).click();
    await panel.screenshot({ path: info.outputPath(`compact-queue-${width}.png`) });
  }
  await table.getByRole("button", { name: "Transfer", exact: true }).focus(); await page.keyboard.press("Enter");
  await table.getByLabel("Transfer destination").selectOption("CONSULTATION");
  await table.getByLabel("Transfer reason").fill("Synthetic handover reason");
  await table.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "transferred" })).toContainText("transferred");
  await expect(panel.getByText("Updating queue…", { exact: true })).toBeHidden();
  expect(writes).toEqual([{ action: "TRANSFER", queueEntryId: "queue-one", targetServicePoint: "CONSULTATION", reason: "Synthetic handover reason" }]);
  await panel.locator(".queueHistory > summary").click();
  const history = panel.getByRole("table").nth(1);
  await expect(history).toContainText("Showing 20 of 21 returned history entries");
  await expect(history.getByRole("rowheader")).toHaveCount(20);
  await expect(history).toContainText("Not recorded"); await expect(history).toContainText("0 min");
  await page.emulateMedia({ media: "print" });
  await expect(panel.getByRole("button", { name: "Call next patient" })).toBeHidden();
  await expect(table.getByRole("button", { name: "Transfer", exact: true })).toBeHidden();
  await expect(table.getByRole("columnheader", { name: "Patient / visit" })).toBeVisible();
  await expect(history.getByRole("rowheader").first()).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.screenshot({ path: info.outputPath("compact-queue-print.png") });
});

test("read-only queue tables cannot introduce service actions", async ({ page }) => {
  await fixture(page, ["visit.read", "admin.dashboard"]);
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [entry], controls, history: [] } }));
  await page.goto("/"); const table = page.locator(".queueWorkTable");
  await expect(table).toContainText("Service permission required");
  await expect(table.getByRole("button")).toHaveCount(0);
  await expect(table.getByText("Escalate overdue review")).toHaveCount(0);
});

test("follow-up table wraps long records on phones and keeps date meaning and print context", async ({ page }, info) => {
  await fixture(page, ["visit.read", "visit.create"]);
  const now = new Date().toISOString();
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.route("**/api/follow-ups", route => route.fulfill({ json: { generatedAt: now, horizon: now, truncated: {}, worklists: { appointments: [], specialty: [], clinical: [], referrals: [{ id: "referral", patient, referralNumber: "TEST-REF-00001", receivingFacility: "Synthetic receiving facility with a long name and details", status: "SENT", updatedAt: now }] } } }));
  await page.goto("/"); await page.getByRole("button", { name: "Follow-up work", exact: true }).click();
  const table = page.getByRole("table");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(table).toContainText("Last update"); await expect(table).toContainText("TEST-REF-00001");
    await expect(table).toContainText("Review access required"); await expect(table.getByRole("button")).toHaveCount(0);
    await table.screenshot({ path: info.outputPath(`compact-follow-up-${width}.png`) });
  }
  await page.getByLabel("Find follow-up work").fill("TEST-REF");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Refresh follow-ups" })).toBeHidden();
  await expect(page.getByLabel("Find follow-up work")).toBeHidden();
  await expect(table.locator("caption")).toContainText("Search: TEST-REF");
  await expect(table.getByRole("columnheader", { name: "Action", exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await table.screenshot({ path: info.outputPath("compact-follow-up-print.png") });
});
