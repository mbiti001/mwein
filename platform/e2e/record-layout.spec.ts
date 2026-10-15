import { test, expect, type Page, type Locator, type TestInfo } from "@playwright/test";
import { documentDefinitions, documentKinds } from "../src/lib/clinic-documents";

async function staff(page: Page, permissions: string[]) {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Layout reviewer", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions, roles: [], mustChangePassword: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [] } }));
  await page.route("**/api/inventory**", route => route.fulfill({ json: { batches: [], items: [], movements: [] } }));
}
async function responsive(page: Page, paper: Locator, info: TestInfo) {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(paper).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const fields = paper.locator(".recordFields > div");
    const positions = await fields.evaluateAll(items => items.slice(0, 2).map(el => el.getBoundingClientRect().y));
    if (width === 1440 && positions.length === 2) expect(positions[0]).toBe(positions[1]);
    await page.screenshot({ path: info.outputPath(`document-${width}.png`), fullPage: true });
  }
}
async function capturePrint(page: Page, buttonName: string, portal: string, bodyClass: string, info: TestInfo) {
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.evaluate(selector => { window.print = () => { (window as any).printedRecord = document.querySelector(selector)?.outerHTML; }; }, portal);
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).printedRecord)).toBeTruthy();
  await page.evaluate(className => { document.body.insertAdjacentHTML("beforeend", (window as any).printedRecord); document.body.classList.add(className); }, bodyClass);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".shell")).toBeHidden();
  await expect(page.locator(portal)).toBeVisible();
  expect(await page.locator(`${portal} .recordFields > div`).evaluateAll(items => items.every(el => el.getBoundingClientRect().right <= innerWidth))).toBe(true);
  await page.pdf({ path: info.outputPath("document.pdf"), format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
}

for (const kind of documentKinds) test(`${kind} saved and printed forms share columns and omit optional blanks`, async ({ page }, info) => {
  const definition = documentDefinitions[kind];
  const record = { id: "layout", kind, reference: `TEST-${kind}-2026-000023`, status: "SIGNED", revision: 2, version: 2,
    payload: Object.fromEntries(definition.fields.map(field => [field.key, field.required ? field.type === "date" ? "2026-10-15" : field.type === "datetime-local" ? "2026-10-15T12:00" : `Synthetic ${field.label}` : " "])),
    context: { facilityName: "Mwein Medical Services", facilityCode: "TEST", timezone: "Africa/Nairobi", patientName: "Synthetic Patient", patientNumber: "TEST-P", visitNumber: "TEST-V" },
    signerName: "Synthetic signer", signerRoles: ["Clinician"], signerRegistration: "TEST-ONLY", signedAt: "2026-10-15T09:00:00Z", contentHash: "synthetic-retained-fingerprint", previousId: "original", previous: { reference: `TEST-${kind}-2026-000001` }, correctionReason: "Synthetic correction history",
  };
  await staff(page, ["encounter.write", "inventory.receive", "visit.create"]);
  await page.route("**/api/clinic-documents?*", route => route.fulfill({ json: route.request().url().includes("visits=1") ? { visits: [] } : { documents: [record], truncated: false } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Clinic forms", exact: true }).click();
  await page.getByRole("combobox", { name: "Document type", exact: true }).selectOption(kind);
  const registerRow = page.getByRole("button", { name: `Open ${record.reference}`, exact: true });
  await expect(registerRow).toContainText("Revision");
  await registerRow.click();
  const paper = page.locator(".clinicFormPaper");
  for (const field of definition.fields.filter(field => !field.required)) await expect(paper.getByText(field.label, { exact: true })).toHaveCount(0);
  await expect(paper).toContainText("Synthetic signer");
  await expect(paper).toContainText("Synthetic correction history");
  await responsive(page, paper, info);
  await capturePrint(page, "Print / Save PDF", "#clinic-form-print", "printingClinicForm", info);
  await expect(page.locator("#clinic-form-print")).toContainText(record.contentHash);
  await expect(page.locator("#clinic-form-print")).toContainText(record.reference);
  await expect(page.locator("#clinic-form-print")).toContainText(record.previous.reference);
});

for (const kind of ["PURCHASE_ORDER", "GOODS_RECEIPT"] as const) test(`${kind} keeps zero quantities, unknown costs and attribution in clean PDF`, async ({ page }, info) => {
  const record = { version: 1, kind, reference: `TEST-${kind}`, facilityName: "Mwein Medical Services", facilityCode: "TEST", status: "APPROVED", date: "2026-10-15T09:00:00Z", supplier: { name: "Synthetic supplier", code: "SUP-001", phone: null, email: " " }, orderNumber: "TEST-PO", expectedAt: null, notes: " ", cancellationReason: null, actors: [{ label: "Recorded by", name: "Synthetic storekeeper", at: "2026-10-15T09:00:00Z" }], lines: [{ code: "ITEM-001", name: "Synthetic supply item", quantity: "5", receivedQuantity: "0", unitCost: null, total: null, batchNumber: "TEST-BATCH", expiryDate: "2027-10-15", storeName: "Synthetic store" }], total: null };
  await staff(page, ["inventory.view"]);
  const intents: string[] = [];
  await page.route("**/api/supply/documents", route => {
    if (route.request().method() === "POST") { intents.push(route.request().postDataJSON().intent); return route.fulfill({ json: { document: record } }); }
    return route.fulfill({ json: { documents: [{ id: "layout", ...record, supplierName: record.supplier.name }], truncated: false } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Pharmacy & stock", exact: true }).click();
  await page.getByRole("button", { name: "Supply documents", exact: true }).click();
  await page.getByRole("button", { name: `View ${record.reference}` }).click();
  const paper = page.locator(".supplyDocumentPaper");
  for (const label of ["Phone", "Email", "Notes", "Expected delivery"]) await expect(paper.getByText(label, { exact: true })).toHaveCount(0);
  await expect(paper).toContainText("Not recorded");
  await expect(paper).toContainText("Synthetic storekeeper");
  if (kind === "PURCHASE_ORDER") await expect(paper.getByRole("cell", { name: "0", exact: true })).toBeVisible();
  await responsive(page, paper, info);
  await capturePrint(page, "Print / Save PDF", "#supply-document-print", "printingSupplyDocument", info);
  expect(intents).toEqual(["PREVIEW", "PRINT"]);
});
