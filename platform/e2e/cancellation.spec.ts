import { expect, test, type Page } from "@playwright/test";

const password = "Mwein-E2E-Password-2026!";
const confirmation = "I confirm this is the correct visit and only unstarted services will be cancelled.";

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
}

function retryPatient(role: string) {
  return test.info().retry ? `Browser Retry ${test.info().retry} Cancel ${role}` : `Browser Cancel ${role}`;
}

// Use the authenticated browser's cookie handling. The production fixture sets a
// Secure session cookie, which Chrome supports on loopback HTTP but the separate
// APIRequestContext does not send there.
async function requestInBrowser(page: Page, pathname: string, options: { method?: "GET" | "POST"; data?: unknown } = {}) {
  return page.evaluate(async ({ pathname, options }) => {
    const response = await fetch(pathname, {
      method: options.method || "GET",
      credentials: "same-origin",
      ...(options.data === undefined ? {} : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options.data),
      }),
    });
    return { status: response.status, ok: response.ok, body: await response.json() };
  }, { pathname, options });
}

async function findVisit(page: Page, patientName: string) {
  await page.getByRole("button", { name: "Visits", exact: true }).click();
  await page.getByRole("searchbox", { name: /visit/i }).fill(patientName);
  await expect(page.getByText(patientName, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel visit", exact: true })).toHaveCount(1);
  const response = await requestInBrowser(page, `/api/visits/cancellation-worklist?q=${encodeURIComponent(patientName)}`);
  expect(response.ok).toBe(true);
  const body = response.body;
  expect(body.visits).toHaveLength(1);
  return body.visits[0] as { id: string; visitNumber: string; patient: { id: string; fullName: string } };
}

test("reception can find an older visit, keep it, then cancel it without clinical or billing access", async ({ page }) => {
  await login(page, "shared.user@example.test");
  await expect(page.getByRole("button", { name: "Consultation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Billing", exact: true })).toHaveCount(0);
  const visit = await findVisit(page, retryPatient("Reception"));
  let cancellationPosts = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === `/api/visits/${visit.id}/cancel`) cancellationPosts += 1;
  });

  await page.getByRole("button", { name: "Cancel visit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel visit", exact: true });
  await expect(dialog).toContainText(visit.patient.fullName);
  await expect(dialog).toContainText(visit.visitNumber);
  await dialog.getByRole("button", { name: "Keep visit", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(cancellationPosts).toBe(0);
  const kept = await requestInBrowser(page, `/api/visits/${visit.id}/cancel`);
  expect(kept.ok).toBe(true);
  expect(kept.body.canCancel).toBe(true);

  await page.getByRole("button", { name: "Cancel visit", exact: true }).click();
  await dialog.getByLabel("Cancellation reason").selectOption("OVERDUE_UNPROCESSED");
  await dialog.getByLabel("Cancellation explanation").fill("Attendance reviewed: patient left before care and will return for a new visit.");
  await expect(dialog.getByRole("button", { name: "Confirm cancellation" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: confirmation }).check();
  await dialog.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(dialog).toBeHidden();
  expect(cancellationPosts).toBe(1);
  const remaining = await requestInBrowser(page, `/api/visits/cancellation-worklist?q=${encodeURIComponent(visit.visitNumber)}`);
  expect(remaining.ok).toBe(true);
  expect(remaining.body.visits).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: visit.id })]));
  const active = await requestInBrowser(page, "/api/visits");
  expect(active.ok).toBe(true);
  expect(active.body.visits).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: visit.id })]));
  expect((await requestInBrowser(page, `/api/patients/${visit.patient.id}/history`)).status).toBe(403);
});

test("shortage-cover clinician can cancel after selecting a patient directly in Consultation", async ({ page }) => {
  await login(page, "clinician.cover@example.test");
  const patientName = retryPatient("Cover");
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await page.getByRole("button").filter({ has: page.getByText(patientName, { exact: true }) }).click();
  await expect(page.getByRole("complementary", { name: "Current patient context" })).toContainText(patientName);
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Current patient context" })).toContainText(patientName);
  await page.getByRole("button", { name: "Cancel this visit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel visit", exact: true });
  await expect(dialog).toContainText(patientName);
  const listed = await requestInBrowser(page, `/api/visits/cancellation-worklist?q=${encodeURIComponent(patientName)}`);
  expect(listed.ok).toBe(true);
  const visit = listed.body.visits[0];
  const details = "Duplicate visit reviewed before clinical work; original patient record retained.";
  await dialog.getByLabel("Cancellation reason").selectOption("DUPLICATE_VISIT");
  await dialog.getByLabel("Cancellation explanation").fill(details);
  await dialog.getByRole("checkbox", { name: confirmation }).check();
  await dialog.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(dialog).toBeHidden();
  const history = await requestInBrowser(page, `/api/patients/${visit.patient.id}/history`);
  expect(history.ok).toBe(true);
  expect(history.body.timeline).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: `visit-${visit.id}`, detail: expect.stringContaining(details) }),
  ]));
});

for (const fixture of [
  { name: "Browser Cancel Signed", blocker: /consultation is already signed/i },
  { name: "Browser Cancel Performed", blocker: /completed care cannot be voided/i },
  { name: "Browser Cancel Paid", blocker: /confirmed payment/i },
]) {
  test(`explains why ${fixture.name} cannot be cancelled before submitting`, async ({ page }) => {
    await login(page, "shared.user@example.test");
    const visit = await findVisit(page, fixture.name);
    let cancellationPosts = 0;
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname === `/api/visits/${visit.id}/cancel`) cancellationPosts += 1;
    });
    await page.getByRole("button", { name: "Cancel visit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel visit", exact: true });
    await expect(dialog).toContainText(fixture.blocker);
    await expect(dialog).not.toContainText("Private synthetic service name");
    await expect(dialog.getByRole("button", { name: "Confirm cancellation" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Keep visit", exact: true }).click();
    expect(cancellationPosts).toBe(0);
    const unchanged = await requestInBrowser(page, `/api/visits/${visit.id}/cancel`);
    expect(unchanged.ok).toBe(true);
    expect(unchanged.body.status).toBe("AWAITING_CLINICIAN");
  });
}

test("staff without cancellation permission cannot open or submit the workflow", async ({ page }) => {
  await login(page, "laboratory@example.test");
  await expect(page.getByRole("button", { name: "Visits", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage visits", exact: true })).toHaveCount(0);
  expect((await requestInBrowser(page, "/api/visits/cancellation-worklist")).status).toBe(403);
  const worklist = await requestInBrowser(page, "/api/visits");
  expect(worklist.ok).toBe(true);
  const visit = worklist.body.visits.find((item: { patient: { fullName: string } }) => item.patient.fullName === "Browser Cancel Mobile");
  expect(visit).toBeDefined();
  expect((await requestInBrowser(page, `/api/visits/${visit.id}/cancel`)).status).toBe(403);
  const result = await requestInBrowser(page, `/api/visits/${visit.id}/cancel`, {
    method: "POST",
    data: { reasonCode: "PATIENT_REQUEST", details: "Unauthorised cancellation must be rejected." },
  });
  expect(result.status).toBe(403);
});

test("visit cancellation confirmation remains usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "shared.user@example.test");
  await page.getByRole("button", { name: "Manage visits", exact: true }).click();
  await page.getByRole("searchbox", { name: /visit/i }).fill("Browser Cancel Mobile");
  await expect(page.getByRole("button", { name: "Cancel visit", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel visit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel visit", exact: true });
  await expect(dialog).toContainText("Browser Cancel Mobile");
  await expect(dialog.getByRole("button", { name: "Keep visit", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dialog.getByRole("button", { name: "Keep visit", exact: true }).click();
  await expect(dialog).toBeHidden();
});
