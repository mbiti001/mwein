import { test, expect, type Page } from "@playwright/test";

const patient = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", patientNumber: "P-WORK-001", fullName: "Synthetic Workflow Patient", sexAtBirth: "UNKNOWN", contacts: [], consents: [] };
const appointmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const visitId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = new Date();
const appointment = { id: appointmentId, patient, clinic: "Outpatient", status: "NO_SHOW", scheduledAt: new Date(now.getTime() - 86400000).toISOString() };
const followUps = {
  generatedAt: now.toISOString(), horizon: new Date(now.getTime() + 14 * 86400000).toISOString(),
  truncated: { appointments: false, referrals: false, specialty: false, clinical: false, clinicalScan: false },
  summary: { missedAppointments: 1, referralFeedback: 1, specialtyReviews: 0, clinicalFollowUps: 1 },
  worklists: { appointments: [appointment], referrals: [{ id: "referral", patient, referralNumber: "REF-WORK-001", receivingFacility: "Synthetic Referral Hospital", status: "SENT", updatedAt: new Date(now.getTime() - 8 * 86400000).toISOString() }], specialty: [], clinical: [{ id: "encounter", patient, visitId, visitNumber: "V-WORK-001", clinic: "Outpatient", followUpAt: now.toISOString() }] },
};
const permissions = ["visit.read", "visit.create", "patient.read", "patient.create", "encounter.write", "referral.read", "clinical.summary.read", "triage.write", "admin.dashboard"];
async function fixture(page: Page, access = permissions) {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Workflow tester", email: "test@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: access, roles: ["TEST"], mustChangePassword: false, mfaRequired: false, mfaEnrolled: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [] } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.route("**/api/follow-ups", route => route.fulfill({ json: followUps }));
  await page.route("**/api/appointments?*", route => route.fulfill({ json: { appointments: [appointment], truncated: false } }));
}

test("follow-up work opens the original appointment and hides inappropriate status actions", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Follow-up work", exact: true }).click();
  await page.getByRole("button", { name: /^Missed appointments/ }).click();
  await page.getByRole("button", { name: "Review appointment" }).click();
  await expect(page.getByRole("button", { name: "Recall missed", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Show all patients" })).toBeVisible();
  await expect(page.getByLabel("Reason for rescheduling")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check in", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare reminder" })).toHaveCount(0);
  await page.getByRole("button", { name: "Appointments", exact: true }).click();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Show all patients" })).toHaveCount(0);
});

test("follow-up links preserve record and referral context, with usable phone filters", async ({ page }, testInfo) => {
  await fixture(page);
  let requestedVisit = "";
  await page.route("**/api/visit-summaries?*", route => {
    requestedVisit = new URL(route.request().url()).searchParams.get("visitId") || "";
    return route.fulfill({ json: { summaries: [{ id: visitId, visitNumber: "V-WORK-001", priority: "ROUTINE", status: "DISCHARGED", clinic: "Outpatient", arrivedAt: now.toISOString(), facility: { name: "Synthetic clinic", code: "TEST" }, patient: { ...patient, allergies: [] }, encounter: null, orders: [], referrals: [], invoice: null }] } });
  });
  await page.route("**/api/service-points*", route => route.fulfill({ json: { metrics: [], records: [] } }));
  await page.route("**/api/referrals?*", route => route.fulfill({ json: { referrals: [] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Follow-up work", exact: true }).click();
  await page.getByRole("button", { name: "Review clinical record" }).click();
  await expect(page.getByRole("heading", { name: "Clinical record", exact: true })).toBeVisible();
  expect(requestedVisit).toBe(visitId);
  await expect(page.locator(".summaryIdentity")).toContainText("V-WORK-001");
  await page.getByRole("button", { name: "Follow-up work", exact: true }).click();
  await page.getByRole("button", { name: "Review referral" }).click();
  await expect(page.getByLabel("Find referral", { exact: true })).toHaveValue("REF-WORK-001");
  await page.getByRole("button", { name: "Follow-up work", exact: true }).click();
  await page.getByLabel("Review dates").selectOption("TODAY");
  await expect(page.locator(".followUpRow")).toHaveCount(1);
  await page.getByLabel("Find follow-up work").fill("unmatched");
  await expect(page.getByText("No follow-ups match these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".followUpRow")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("follow-up-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator("#main-navigation").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("follow-up-mobile.png"), fullPage: true });
});

test("a reception role cannot open clinical records or referral actions from follow-ups", async ({ page }) => {
  await fixture(page, ["visit.read", "visit.create", "patient.read"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Follow-up work", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review appointment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review clinical record" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review referral" })).toHaveCount(0);
});

test("failed appointment refresh removes actionable stale rows and supports retry", async ({ page }) => {
  await fixture(page);
  let failed = false;
  await page.route("**/api/appointments?*", route => route.fulfill(failed ? { status: 503, json: { error: "Appointment service unavailable" } } : { json: { appointments: [{ ...appointment, status: "SCHEDULED", scheduledAt: new Date(now.getTime() + 3600000).toISOString() }], truncated: false } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Appointments", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark no-show" })).toHaveCount(0);
  failed = true;
  await page.getByRole("button", { name: "Refresh appointments" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Appointment service unavailable");
  await expect(page.getByRole("button", { name: "Check in", exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Refresh appointments" }).click();
  await expect(page.getByRole("button", { name: "Check in", exact: true })).toBeEnabled();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("superseded patient searches cannot replace the latest matches", async ({ page }) => {
  await fixture(page);
  let releaseOld!: () => void;
  const oldReady = new Promise<void>(resolve => { releaseOld = resolve; });
  let oldRequested!: () => void;
  const requested = new Promise<void>(resolve => { oldRequested = resolve; });
  await page.route("**/api/patients?*", async route => {
    const old = new URL(route.request().url()).searchParams.get("q") === "Old";
    if (old) { oldRequested(); await oldReady; }
    await route.fulfill({ json: { patients: [{ ...patient, fullName: old ? "Old Patient" : "Current Patient" }] } });
  });
  await page.goto("/");
  const search = page.getByRole("searchbox", { name: "Find a patient anywhere" });
  await search.fill("Old"); await requested;
  await search.fill("Current");
  await expect(page.getByRole("button", { name: /Current Patient/ })).toBeVisible();
  releaseOld();
  await expect(page.getByRole("button", { name: /Old Patient/ })).toHaveCount(0);
  await search.fill("");
  await expect(page.getByRole("button", { name: /Current Patient/ })).toHaveCount(0);
});

test("booking preserves input after failure and resets cleanly after a saved retry", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/patients?*", route => route.fulfill({ json: { patients: [patient] } }));
  let calls = 0;
  await page.route("**/api/appointments", async route => {
    calls++;
    await route.fulfill(calls === 1 ? { status: 503, json: { error: "Booking temporarily unavailable" } } : { status: 201, json: { appointment } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Appointments", exact: true }).click();
  await page.locator("details").filter({ hasText: "Book appointment" }).locator("summary").click();
  await page.getByLabel("Patient *", { exact: true }).fill("Synthetic");
  await page.getByRole("button", { name: /Synthetic Workflow Patient P-WORK/ }).click();
  await page.getByLabel("Reception note").fill("Synthetic administrative note");
  await page.getByRole("button", { name: "Book appointment", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Booking temporarily unavailable");
  await expect(page.getByLabel("Reception note")).toHaveValue("Synthetic administrative note");
  await page.getByRole("button", { name: "Book appointment", exact: true }).click();
  await expect(page.getByText("Appointment booked for Synthetic Workflow Patient.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Reception note")).toHaveValue("");
  await expect(page.getByRole("button", { name: "All appointments", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(calls).toBe(2);
});

test("queue failure disables controls and changing service shows its saved target", async ({ page }) => {
  await fixture(page);
  let failed = true;
  await page.route("**/api/queues", route => route.fulfill(failed ? { status: 503, json: { error: "Queue unavailable" } } : { json: { entries: [], history: [], controls: [{ servicePoint: "TRIAGE", paused: false, targetMinutes: 15 }, { servicePoint: "CONSULTATION", paused: true, pauseReason: "Synthetic staff handover", targetMinutes: 45 }] } }));
  await page.goto("/");
  const panel = page.locator(".queueOperations");
  await expect(panel.getByRole("alert")).toContainText("Queue unavailable");
  await expect(panel.getByRole("button", { name: "Call next patient" })).toBeDisabled();
  await expect(panel.getByText("STATUS UNAVAILABLE", { exact: true })).toBeVisible();
  failed = false;
  await panel.getByRole("button", { name: "Refresh queue" }).click();
  await expect(panel.getByLabel("Routine target (minutes)")).toHaveValue("15");
  await panel.getByRole("button", { name: "CONSULTATION", exact: true }).click();
  await expect(panel.getByLabel("Routine target (minutes)")).toHaveValue("45");
  await expect(panel.getByText("Synthetic staff handover", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Call next patient" })).toBeDisabled();
});

test("changing to another patient starts a fresh check-in without the previous appointment", async ({ page }) => {
  await fixture(page);
  const other = { ...patient, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", patientNumber: "P-WORK-002", fullName: "Different Synthetic Patient" };
  await page.route("**/api/appointments?*", route => route.fulfill({ json: { appointments: [{ ...appointment, status: "SCHEDULED" }], truncated: false } }));
  await page.route("**/api/patients?*", route => route.fulfill({ json: { patients: [other] } }));
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/visits", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { visits: [] } });
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { visit: { id: visitId, visitNumber: "V-NEW-PATIENT", clinic: "Outpatient" } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Appointments", exact: true }).click();
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Change patient", exact: true })).toBeDisabled();
  await page.getByRole("searchbox", { name: "Find a patient anywhere" }).fill("Different");
  await page.getByRole("button", { name: /Different Synthetic Patient P-WORK-002/ }).click();
  await expect(page.getByRole("button", { name: "Change patient", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Check in patient", exact: true }).click();
  await expect(page.getByText(/V-NEW-PATIENT started/)).toBeVisible();
  expect(submitted).toMatchObject({ patientId: other.id, visitType: "WALK_IN", clinic: "Outpatient" });
  expect(submitted).not.toHaveProperty("appointmentId");
});
