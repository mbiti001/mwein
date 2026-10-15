import { test, expect, type Page } from "@playwright/test";

const medicine = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", code: "TEST", name: "Synthetic medicine" };
const batch = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", batchNumber: "SYNTHETIC-BATCH", expiryDate: "2030-10-15", quantityAvailable: 20 };
function visit(id = "one") { return {
  id, visitNumber: `V-${id}`, clinic: "Outpatient", priority: "ROUTINE", status: "AWAITING_PHARMACY", arrivedAt: "2026-10-15T10:00:00Z",
  patient: { id, patientNumber: `P-${id}`, fullName: `Synthetic ${id}`, estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", allergies: [] },
  facility: { name: "Synthetic clinic" }, triage: { observations: [] }, encounters: [],
  orders: [{ id: `order-${id}`, type: "MEDICATION", status: "REQUESTED", displayName: medicine.name, orderedBy: { displayName: "Synthetic clinician" },
    prescription: { quantity: "10", dispensedQuantity: "0", dispenseStatus: "PENDING", genericName: medicine.name, medicineCode: "TEST", dose: "Synthetic dose", route: "Test route", frequency: "Test frequency", duration: "Test course" } }],
}; }
function preview(quantity = 10, available = 20) { return { outstanding: 10, available, allocation: [{ ...batch, quantity: Math.min(quantity, available) }], standardAllocation: [], batches: [batch], fefoOverridden: false, substitutionRequired: false, prescribedCatalogItem: medicine, selectedCatalogItem: medicine, medicines: [{ ...medicine, available }] }; }
function result(quantity = 4) { return { allocations: [{ ...batch, quantity }], remainingOrders: quantity < 10 ? 1 : 0, remainingQuantity: 10 - quantity, dispenseStatus: quantity < 10 ? "PARTIALLY_DISPENSED" : "DISPENSED", dispensedMedicine: medicine }; }
async function fixture(page: Page) {
  const state = { visits: [visit(), visit("two")], failRefresh: false };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Synthetic pharmacist", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["visit.read", "pharmacy.dispense", "inventory.view"], roles: [], mustChangePassword: false } } }));
  await page.route("**/api/visits", route => route.fulfill(state.failRefresh ? { status: 503, json: { error: "Synthetic refresh failure" } } : { json: { visits: state.visits } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.route("**/api/orders/*/dispense**", route => route.request().method() === "GET" ? route.fulfill({ json: preview(Number(new URL(route.request().url()).searchParams.get("quantity") || 10)) }) : route.fallback());
  await page.goto("/"); await page.getByRole("button", { name: "Pharmacy & stock", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic one.*P-one/ }).click();
  return state;
}
const quantity = (page: Page) => page.locator('[name="quantity"]');
const counselling = (page: Page) => page.locator('[name="counsellingCompleted"]');

test("confirmed partial supply survives refresh failure and requires fresh preparation", async ({ page }) => {
  const state = await fixture(page); const posts: any[] = [];
  await page.route("**/api/orders/*/dispense", route => {
    if (route.request().method() !== "POST") return route.fallback();
    posts.push(route.request().postDataJSON()); state.failRefresh = true;
    state.visits[0].orders[0].status = "IN_PROGRESS";
    Object.assign(state.visits[0].orders[0].prescription, { dispensedQuantity: "4", dispenseStatus: "PARTIALLY_DISPENSED" });
    return route.fulfill({ json: result() });
  });
  await quantity(page).fill("4"); await counselling(page).check();
  await page.getByRole("button", { name: "Confirm partial supply" }).click();
  await expect(page.getByText("Supply decision recorded", { exact: true })).toBeVisible();
  await expect(page.getByText(/Supply is recorded, but pharmacy records could not refresh/)).toBeVisible();
  await expect(quantity(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare remaining supply" })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh pharmacy records" }).click(); expect(posts).toHaveLength(1);
  state.failRefresh = false;
  await page.getByRole("button", { name: "Refresh pharmacy records" }).click();
  await page.getByRole("button", { name: "Prepare remaining supply" }).click();
  await expect(quantity(page)).toHaveValue("6"); await expect(counselling(page)).not.toBeChecked();
  expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "← Back to queue" }).click();
  await expect(page.locator(".medicineLabel")).toContainText("Synthetic one");
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.body.classList.add("printingMedicineLabel"));
  await expect(page.locator(".medicineLabel")).toBeVisible();
  await expect(page.locator(".medicineLabel button")).toBeHidden();
});

test("lost dispensing response locks details and retries the exact request with responsive recovery", async ({ page }, info) => {
  await fixture(page); const posts: any[] = []; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/orders/*/dispense", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    posts.push(route.request().postDataJSON());
    if (posts.length === 1) { await pending; return route.abort("failed"); }
    if (posts.length === 2) return route.fulfill({ status: 503, json: { error: "Synthetic retry outage" } });
    return route.fulfill({ json: { ...result(), replayed: true } });
  });
  await quantity(page).fill("4"); await counselling(page).check();
  await page.locator('[name="notes"]').fill("Retain this synthetic supply reason");
  await page.getByRole("button", { name: "Confirm partial supply" }).click();
  await expect(quantity(page)).toBeDisabled();
  await page.locator("form").evaluate(form => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(posts).toHaveLength(1); release();
  const recovery = page.locator(".pharmacyRecovery").filter({ hasText: "Supply outcome not confirmed" });
  await expect(recovery).toBeVisible(); await expect(quantity(page)).toBeDisabled();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right, text: el.textContent?.slice(0, 70) })));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: ${JSON.stringify(overflow)}`).toBe(true);
    await page.screenshot({ path: info.outputPath(`pharmacy-recovery-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ media: "print" }); await expect(recovery).toBeHidden(); await page.emulateMedia({ media: "screen" });
  await recovery.getByRole("button", { name: "Retry same dispensing" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("Synthetic retry outage", { exact: true })).toBeVisible();
  await expect(quantity(page)).toBeDisabled();
  await recovery.getByRole("button", { name: "Retry same dispensing" }).click();
  await expect(page.getByText("Already recorded. Stock and billing were not changed again.")).toBeVisible();
  expect(posts).toHaveLength(3); expect(posts[1]).toEqual(posts[0]); expect(posts[2]).toEqual(posts[0]);
});

test("stock failures are retryable and late failures cannot replace a newer plan", async ({ page }) => {
  await fixture(page); let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  let failed = true;
  await page.route("**/api/orders/*/dispense**", async route => {
    const q = Number(new URL(route.request().url()).searchParams.get("quantity") || 10);
    if (q === 3) { await pending; return route.fulfill({ status: 503, json: { error: "Stale stock failure" } }); }
    return route.fulfill(failed ? { status: 503, json: { error: "Current stock unavailable" } } : { json: preview(q, 2) });
  });
  await quantity(page).fill("4");
  await expect(page.getByText("Current stock unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm partial supply" })).toBeDisabled();
  failed = false; await page.getByRole("button", { name: "Retry stock check" }).click();
  await expect(page.getByRole("button", { name: "Confirm partial supply" })).toBeDisabled();
  await quantity(page).fill("3"); await quantity(page).fill("2");
  await expect(page.getByRole("button", { name: "Confirm partial supply" })).toBeEnabled();
  const stale = page.waitForResponse(response => response.url().includes("quantity=3"));
  release(); await (await stale).finished();
  await expect(page.getByText("Stale stock failure", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm partial supply" })).toBeEnabled();
});

test("not-supplied decisions require a reason without a dispensing quantity", async ({ page }) => {
  await fixture(page); const posts: any[] = [];
  await page.route("**/api/orders/*/dispense", route => {
    if (route.request().method() !== "POST") return route.fallback();
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { allocations: [], remainingQuantity: 0, remainingOrders: 0, dispenseStatus: "NOT_DISPENSED" } });
  });
  await quantity(page).fill("0");
  await page.locator('[name="action"]').selectOption("NOT_DISPENSED");
  await expect(quantity(page)).toBeDisabled();
  await page.getByRole("button", { name: "Record not supplied" }).click(); expect(posts).toHaveLength(0);
  await page.locator('[name="notes"]').fill("Synthetic stock shortage, no supply");
  await page.getByRole("button", { name: "Record not supplied" }).click();
  await expect(page.getByText("Decision recorded. No stock was deducted.")).toBeVisible();
  expect(posts[0]).not.toHaveProperty("quantity"); expect(posts[0].notes).toContain("stock shortage");
});

test("late supply confirmation cannot label or replace another patient's review", async ({ page }) => {
  await fixture(page); let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/orders/*/dispense", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await pending; return route.fulfill({ json: result() });
  });
  await quantity(page).fill("4"); await counselling(page).check();
  await page.getByRole("button", { name: "Confirm partial supply" }).click();
  await page.getByRole("button", { name: "← Back to queue" }).click();
  await page.getByRole("button", { name: /Synthetic two.*P-two/ }).click();
  const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/dispense"));
  release(); await (await response).finished();
  await expect(quantity(page)).toBeEnabled();
  await expect(page.locator(".patientBanner")).toContainText("Synthetic two");
  await expect(page.getByText(/Dispensed Synthetic medicine/)).toHaveCount(0);
  await page.getByRole("button", { name: "← Back to queue" }).click();
  await expect(page.locator(".medicineLabel")).toHaveCount(0);
});
