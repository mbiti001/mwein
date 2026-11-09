import { test, expect, type Page } from "@playwright/test";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const items = ["A", "B"].map((code) => ({
  code: "SYNTH-" + code,
  name: "Synthetic brand " + code,
  genericName: "Synthetic medicine " + code,
  strength: "100 mg",
  dosageForm: "Tablet",
  unitOfMeasure: "tablet",
  category: "PHARMACEUTICAL",
  unitPrice: 10,
  active: true,
  prescribingDefaults: { route: "Oral", frequencyPerDay: 1, durationDays: 2, doseUnit: "tablet", doseUnitsPerIssueUnit: 1, wholeIssueUnits: false },
}));
const patient = {
  id,
  patientNumber: "P-RX",
  fullName: "Synthetic Prescription",
  estimatedAgeYears: 30,
  sexAtBirth: "UNKNOWN",
  allergies: [],
};
const visit = {
  id,
  visitNumber: "V-RX",
  clinic: "Outpatient",
  priority: "ROUTINE",
  status: "UNDER_CONSULTATION",
  arrivedAt: "2026-10-16T09:00:00Z",
  patient,
  encounters: [],
  orders: [],
};
async function fixture(page: Page, orders: object[] = []) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          displayName: "Synthetic clinician",
          facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" },
          permissions: [
            "visit.read",
            "encounter.write",
            "clinical.history.read",
            "admin.catalog",
          ],
          roles: ["CLINICIAN"],
          mustChangePassword: false,
        },
      },
    }),
  );
  await page.route("**/api/visits", (route) =>
    route.fulfill({ json: { visits: [{ ...visit, orders }] } }),
  );
  await page.route("**/api/queues", (route) =>
    route.fulfill({ json: { entries: [], controls: [], history: [] } }),
  );
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ json: { items } }),
  );
  await page.route("**/api/patients/*/history?*", (route) =>
    route.fulfill({ json: { visits: [], problems: [], timeline: [] } }),
  );
  await page.route("**/api/visits/*/vitals", (route) =>
    route.fulfill({ json: { measurements: [], truncated: false } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await page
    .getByRole("button", { name: /Synthetic Prescription.*P-RX/ })
    .click();
  await page.getByRole("navigation", { name: "Encounter sections" }).getByRole("button", { name: "Prescription", exact: true }).click();
}
async function fill(page: Page, code = "A") {
  await page
    .getByPlaceholder("Search medicine by generic, brand or strength…")
    .fill("brand " + code);
  await page
    .getByRole("button", { name: new RegExp("Synthetic medicine " + code) })
    .click();
  await expect(page.locator('[name="medicineIndication"]')).toHaveCount(0);
  await expect(page.locator('[name="doseQuantity"]')).toHaveCount(0);
  await page.locator('[name="dose"]').fill("1 tablet");
  await page.locator('[name="route"]').selectOption("Oral");
  await page.locator('[name="frequencyPerDay"]').selectOption("1");
  await page.locator('[name="durationDays"]').fill("2");

  await page.getByText("Additional patient instructions", { exact: true }).click();
  await page
    .locator('[name="medicineInstructions"]')
    .fill("Synthetic patient instructions");
}
const saved = (data: any) =>
  data.prescriptions.map((line: any, index: number) => ({
    id: line.existingOrderId || id.slice(0, -1) + index,
    type: "MEDICATION",
    status: data.submit ? "REQUESTED" : "DRAFT",
    displayName: "Synthetic medicine " + line.medicineCode.slice(-1),
    clinicalIndication: line.indication,
    orderedBy: { displayName: "Synthetic clinician" },
    prescription: {
      ...line,
      quantity: String(line.quantity),
      dispensedQuantity: "0",
      dispenseStatus: "PENDING",
      idempotencyKey: index
        ? data.idempotencyKey + ":" + index
        : data.idempotencyKey,
    },
  }));

test("saving a medicine keeps the saved list clear and the next search focused", async ({ page }) => {
  const orders: ReturnType<typeof saved> = [];
  await page.route("**/api/visits/*/consultation", route => {
    const [order] = saved(route.request().postDataJSON().data);
    orders.push({ ...order, id: order.prescription.medicineCode });
    return route.fulfill({ json: { orders } });
  });
  await fixture(page);
  const editor = page.getByRole("group", { name: "Add a medicine" });
  const search = editor.getByPlaceholder("Search medicine by generic, brand or strength…");
  const list = page.getByRole("table", { name: "Saved prescriptions" });
  for (const code of ["A", "B"]) {
    await search.fill("brand " + code);
    const option = editor.getByRole("button", { name: new RegExp("Synthetic medicine " + code) });
    await expect(option).toBeVisible();
    if (code === "A") await option.click();
    else {
      await search.press("Tab");
      await expect(option).toBeFocused();
      await option.press("Enter");
    }
    await editor.getByLabel("Dose (tablet) *").fill("1");
    await editor.getByRole("button", { name: "Save prescription" }).click();
    await expect(list.getByRole("row", { name: new RegExp("Synthetic medicine " + code) })).toContainText("Sent to pharmacy");
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(editor.getByRole("listbox")).toHaveCount(0);
  }
  await expect(list.locator("tbody tr")).toHaveCount(2);
  for (const width of [834, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(list.getByText("Unit price", { exact: true }).last()).toBeVisible();
    await expect.poll(() => list.evaluate(table => {
      const wrapper = table.parentElement!;
      return wrapper.scrollWidth - wrapper.clientWidth;
    })).toBe(0);
  }
});

test("a lost save response locks the editor and retries the same medicine", async ({page}) => {
  const posts: any[] = [];
  await page.route("**/api/visits/*/consultation", route => {
    const body = route.request().postDataJSON();
    posts.push(body);
    if (posts.length === 1) return route.abort("failed");
    return route.fulfill({json:{orders:saved(body.data)}});
  });
  await fixture(page);
  await fill(page);
  await page.getByRole("button",{name:"Save prescription",exact:true}).click();
  await expect(page.locator('[name="dose"]')).toBeDisabled();
  await page.getByRole("button",{name:"Retry unchanged prescription"}).click();
  await expect(page.locator(".rxSaved tbody tr")).toHaveCount(1);
  expect(posts[1]).toEqual(posts[0]);
  await expect(page.locator('[name="medicineCode"]')).toHaveValue("");
  await expect(page.getByLabel("Unsaved consultation changes")).toHaveCount(0);
  await page.emulateMedia({media:"print"});
  await expect(page.locator(".rxEditor")).toBeHidden();
  await expect(page.locator(".rxSaved table")).toBeVisible();
});

test("saved draft review hydrates all fields and saves against the original revision", async ({
  page,
}) => {
  const initial = saved({
    idempotencyKey: id,
    submit: false,
    prescriptions: [
      {
        medicineCode: "SYNTH-A",
        indication: "Synthetic indication",
        dose: "2 tablets",
        doseQuantity: 2,
        route: "Oral",
        frequency: "Twice daily",
        frequencyPerDay: 2,
        duration: "3 days",
        durationDays: 3,
        startDate: "2026-10-16",
        quantity: 12,
        instructions: "Retained synthetic instructions",
        doseTiming: "SCHEDULED",
      },
    ],
  });
  const posts: any[] = [];
  await page.route("**/api/visits/*/consultation", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { visit: { ...visit, orders: initial } } });
    const body = route.request().postDataJSON();
    posts.push(body);
    return route.fulfill({ json: { orders: saved(body.data) } });
  });
  await fixture(page, initial);
  await page.getByRole("button", { name: "Correct", exact: true }).click();
  await expect(page.locator('[name="dose"]')).toHaveValue("2 tablets");
  await expect(page.locator('[name="quantity"]')).toHaveValue("12");
  await expect(page.locator('[name="medicineInstructions"]')).toHaveValue(
    "Retained synthetic instructions",
  );
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(page.locator(".rxSaved")).toContainText("Sent to pharmacy");
  expect(posts[0].data.prescriptions[0]).toMatchObject({
    existingOrderId: initial[0].id,
    expectedPrescriptionKey: id,
    dose: "2 tablets",
    quantity: 12,
  });
  await expect(page.locator(".rxSaved tbody tr")).toHaveCount(1);
});

test("validation failure retains the editable prescription and save actions follow review", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/visits/*/consultation", (route) => {
    posts++;
    return route.fulfill({
      status: 422,
      json: { error: "Synthetic clinical review required" },
    });
  });
  await fixture(page);
  await fill(page);
  await page
    .getByRole("button", { name: "Save prescription", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic clinical review required", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[name="dose"]')).toBeEnabled();
  await expect(page.locator('[name="dose"]')).toHaveValue("1 tablet");
  await expect(page.getByRole("button",{name:"Save prescription",exact:true})).toHaveCount(1);
  expect(posts).toBe(1);
});

test("prescription uses one dose in a compact row with editable facility defaults and automatic quantity", async ({ page }, info) => {
  await fixture(page);
  await fill(page);
  await expect(page.locator('[name="quantity"]')).toHaveAttribute("readonly", "");
  await expect(page.locator('[name="stopDate"]')).toBeHidden();
  await expect(page.locator('[name="quantity"]')).toHaveValue("2");
  await page.locator('[name="durationDays"]').fill("");
  await expect(page.locator('[name="quantity"]')).toHaveValue("");
  await page.locator('[name="durationDays"]').fill("2");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    const group = page.locator(".rxCompactEditor");
    expect(await group.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBeGreaterThanOrEqual(2);
    if (width <= 390) expect((await page.locator('[name="frequencyPerDay"]').boundingBox())!.width).toBeGreaterThan(200);
    await page.evaluate(() => window.scrollTo(0, 0));
    const bounds = await page.locator(".prescriptionComposer").boundingBox();
    expect(bounds).not.toBeNull();
    await page.screenshot({ path: info.outputPath(`prescription-entry-${width}.png`), fullPage: true, clip: bounds! });
  }
  await expect(page.locator(".rxEditor")).toHaveCount(1);
  await expect(page.locator(".rxSaved table")).toHaveCount(1);
});

test("collapsed course details reveal invalid dates without losing medicine directions", async ({ page }) => {
  await fixture(page);
  await fill(page);
  const summary = page.locator(".rxCourseDetails > summary").filter({ hasText: "Course dates" });
  await summary.focus();
  await page.keyboard.press("Enter");
  await page.locator('[name="startDate"]').fill("");
  await summary.click();
  await expect(page.locator('[name="startDate"]')).toBeHidden();
  await page.getByRole("button", { name: "Save prescription", exact: true }).click();
  await expect(page.locator('[name="startDate"]')).toBeVisible();
  await expect(page.locator('[name="dose"]')).toHaveValue("1 tablet");
  await expect(page.getByLabel("Medicines to save").locator("article")).toHaveCount(0);
});

test("Kenya references prepare inactive, attributed catalogue entries without invented units or prices", async ({
  page,
}, info) => {
  const posts: any[] = [];
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          displayName: "Synthetic administrator",
          facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" },
          permissions: ["visit.read", "admin.catalog", "admin.dashboard"],
          roles: ["ADMIN"],
          mustChangePassword: false,
        },
      },
    }),
  );
  await page.route("**/api/admin/overview", (route) =>
    route.fulfill({ status: 503, json: {error:"Synthetic dashboard unavailable"} }),
  );
  await page.route("**/api/catalog", (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ json: { item: { id }, items: [] } });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Services & pricing", exact: true })
    .click();
  await page.getByRole("button", { name: /Pharmaceuticals/ }).click();
  await page.locator(".managementPanel > summary").click();
  await page
    .getByPlaceholder("Search Kenya medicine references…")
    .fill("Paracetamol");
  await page
    .getByRole("button", { name: /Paracetamol · 500 mg · Tablet/ })
    .click();
  await expect(page.locator('[name="genericName"]')).toHaveValue("Paracetamol");
  await expect(page.locator('[name="strength"]')).toHaveValue("500 mg");
  await expect(page.locator('[name="dosageForm"]')).toHaveValue(
    "Tablet (scored)",
  );
  await expect(page.locator('[name="active"]')).not.toBeChecked();
  await expect(page.locator('[name="unitOfMeasure"]')).toHaveValue("");
  await expect(page.locator('textarea[name="description"]')).toHaveValue(
    /Kenya Essential Medicines List 2023.*section 3.1.6/,
  );
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page
    .locator(".kenyaMedicineReference")
    .screenshot({ path: info.outputPath("kenya-reference-phone.png") });
  await page.locator('[name="unitOfMeasure"]').fill("tablet");
  await page.locator('[name="unitPrice"]').fill("5");
  await expect(page.locator('[name="defaultRoute"]')).toHaveValue("");
  await expect(page.locator('[name="defaultFrequency"]')).toHaveValue("");
  await page.locator('[name="defaultRoute"]').fill("Oral");
  await page.locator('[name="defaultFrequency"]').fill("2");
  await page.locator('[name="defaultDuration"]').fill("3");
  await page.locator('[name="doseUnit"]').fill("tablet");
  await page.locator('[name="doseUnitsPerIssueUnit"]').fill("1");
  await page
    .locator(".catalogForm")
    .getByRole("button", { name: /Add to catalogue/ })
    .click();
  await expect(
    page.getByText("Catalogue item added.", { exact: true }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    active: false,
    genericName: "Paracetamol",
    strength: "500 mg",
    dosageForm: "Tablet (scored)",
    unitOfMeasure: "tablet",
    prescribingDefaults: { route: "Oral", frequencyPerDay: 2, durationDays: 3, doseUnit: "tablet", doseUnitsPerIssueUnit: 1, wholeIssueUnits: false },
  });
});

test("configured liquid conversion calculates whole bottles from one dose", async ({page}) => {
  await fixture(page);
  await page.route("**/api/catalog", route => route.fulfill({json:{items:items.map(item=>({...item, unitOfMeasure:"bottle", dosageForm:"Oral liquid", prescribingDefaults:{...item.prescribingDefaults, doseUnit:"mL", doseUnitsPerIssueUnit:100, wholeIssueUnits:true, frequencyPerDay:3, durationDays:7}}))}}));
  await page.reload();
  await page.getByRole("button",{name:"Consultation",exact:true}).click();
  await page.getByRole("button",{name:/Synthetic Prescription.*P-RX/}).click();
  await page.getByRole("navigation", { name: "Encounter sections" }).getByRole("button", { name: "Prescription", exact: true }).click();
  await page.getByPlaceholder("Search medicine by generic, brand or strength…").fill("brand A");
  await page.getByRole("button",{name:/Synthetic medicine A/}).click();
  await expect(page.locator('[name="route"]')).toHaveValue("Oral");
  await expect(page.locator('[name="frequencyPerDay"]')).toHaveValue("3");
  await expect(page.locator('[name="durationDays"]')).toHaveValue("7");
  await page.locator('[name="dose"]').fill("5");
  await expect(page.locator('[name="quantity"]')).toHaveValue("2");
  await expect(page.getByText(/Written prescription:/)).toContainText("5 mL");
});
test("missing facility defaults stay blank and cannot invent a regimen", async ({page}) => {
  await fixture(page);
  await page.route("**/api/catalog", route => route.fulfill({json:{items:items.map(item=>({...item, prescribingDefaults:null}))}}));
  await page.reload();
  await page.getByRole("button",{name:"Consultation",exact:true}).click();
  await page.getByRole("button",{name:/Synthetic Prescription.*P-RX/}).click();
  await page.getByRole("navigation", { name: "Encounter sections" }).getByRole("button", { name: "Prescription", exact: true }).click();
  await page.getByPlaceholder("Search medicine by generic, brand or strength…").fill("brand A");
  await page.getByRole("button",{name:/Synthetic medicine A/}).click();
  await expect(page.getByRole("status").filter({hasText:"Facility prescribing defaults"})).toHaveCount(0);
  for (const name of ["route", "frequencyPerDay", "durationDays", "quantity"]) await expect(page.locator('[name="'+name+'"]')).toHaveValue("");
  await page.locator('[name="dose"]').fill("1");
  await page.locator('[name="route"]').selectOption("Oral");
  await page.locator('[name="frequencyPerDay"]').selectOption("2");
  await page.locator('[name="durationDays"]').fill("3");
  await expect(page.locator('[name="quantity"]')).toHaveValue("6");
});

test("encounter lists pharmacy's partial and not-supplied outcomes", async ({ page }) => {
  const orders = ["PARTIALLY_DISPENSED", "NOT_DISPENSED"].map((dispenseStatus, index) => ({
    id: "outcome-" + index, type: "MEDICATION", status: index ? "COMPLETED" : "IN_PROGRESS",
    displayName: "Synthetic item " + index,
    prescription: { dispenseStatus, quantity: "10", dispensedQuantity: index ? "0" : "4" },
  }));
  await fixture(page, orders);
  const list = page.getByRole("table", { name: "Saved prescriptions" });
  await expect(list.getByRole("row", { name: /Synthetic item 0/ })).toContainText("Partially dispensed");
  await expect(list.getByRole("row", { name: /Synthetic item 1/ })).toContainText("Not supplied");
  await expect(list.getByRole("button", { name: "Correct" })).toHaveCount(0);
});
