import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function authenticate(request: APIRequestContext, email: string, facilityCode = "MMS") {
  const origin = `http://127.0.0.1:${process.env.E2E_APP_PORT || "3210"}`;
  const response = await request.post("/api/auth/login", { headers: { origin }, data: { facilityCode, email, password: "Mwein-E2E-Password-2026!" } });
  expect(response.status()).toBe(200);
  return { origin, cookie: response.headers()["set-cookie"].split(";")[0] };
}

test("appointment and recall access stays within the facility and retains attributable audit history", async ({ request }) => {
  test.setTimeout(60_000);
  const admin = await authenticate(request, "admin@mwein.local");
  const other = await authenticate(request, "shared.user@example.test", "OTHER");
  const laboratory = await authenticate(request, "laboratory@example.test");
  async function get(path: string, headers = admin) {
    const response = await request.get(path, { headers });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    return response.json();
  }
  for (const path of ["/api/appointments", "/api/follow-ups"]) {
    const response = await request.get(path, { headers: { cookie: "" } });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  }
  const patientResponse = await request.post("/api/patients", { headers: admin, data: { givenName: "Recall", familyName: `Synthetic-${randomUUID().slice(0, 8)}`, phone: "+254700000005", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false } });
  expect(patientResponse.status()).toBe(201);
  const { patient } = await patientResponse.json();
  const scheduledAt = new Date(Date.now() + 86400000).toISOString();
  const booking = { patientId: patient.id, scheduledAt, clinic: "Outpatient" };
  const booked = await request.post("/api/appointments", { headers: admin, data: booking });
  expect(booked.status()).toBe(201);
  const { appointment } = await booked.json();
  expect((await request.post("/api/appointments", { headers: other, data: booking })).status()).toBe(404);
  expect((await request.post("/api/appointments", { headers: laboratory, data: booking })).status()).toBe(403);
  const query = `/api/appointments?scope=all&patientId=${patient.id}`;
  expect((await get(query)).appointments.map((row: { id: string }) => row.id)).toEqual([appointment.id]);
  expect((await get(query, other)).appointments).toEqual([]);
  const path = `/api/appointments/${appointment.id}/status`;
  expect((await request.patch(path, { headers: other, data: { status: "CANCELLED" } })).status()).toBe(404);
  expect((await request.patch(path, { headers: laboratory, data: { status: "CANCELLED" } })).status()).toBe(403);
  expect((await get(query)).appointments[0].status).toBe("SCHEDULED");
  const nextTime = new Date(Date.now() + 2 * 86400000).toISOString();
  const reason = "Synthetic appointment access audit";
  const changed = await request.patch(path, { headers: admin, data: { action: "RESCHEDULE", scheduledAt: nextTime, reason } });
  expect(changed.status()).toBe(200);
  expect((await get(query)).appointments[0].scheduledAt).toBe(nextTime);
  const ownFollowUps = await get("/api/follow-ups"), otherFollowUps = await get("/api/follow-ups", other);
  const ownIds = Object.values(ownFollowUps.worklists).flat().map(row => (row as { id: string }).id);
  expect(ownIds.length).toBeGreaterThan(0); // The isolated fixture contains missed and signed-plan work.
  const otherIds = Object.values(otherFollowUps.worklists).flat().map(row => (row as { id: string }).id);
  expect(otherIds.filter(id => ownIds.includes(id))).toEqual([]);
  const me = await get("/api/auth/me");
  const audit = await get("/api/admin/audit/export");
  expect(audit.chain.valid).toBe(true);
  const bookedEvents = audit.events.filter((event: { action: string; entityId: string }) => event.entityId === appointment.id && event.action === "APPOINTMENT_BOOKED");
  expect(bookedEvents).toHaveLength(1);
  const changedEvents = audit.events.filter((event: { action: string; entityId: string }) => event.entityId === appointment.id && event.action === "APPOINTMENT_RESCHEDULED");
  expect(changedEvents).toHaveLength(1);
  expect(changedEvents[0]).toMatchObject({ userId: me.user.id, facilityId: me.user.facilityId, reason, beforeHash: `${scheduledAt}:Outpatient:SCHEDULED`, afterHash: `${nextTime}:Outpatient:SCHEDULED` });
  for (const context of ["APPOINTMENTS", "FOLLOW_UPS"]) {
    const events = audit.events.filter((event: { reason: string }) => event.reason === context);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event: { userId: string; sessionId: string; facilityId: string }) => event.userId && event.sessionId && event.facilityId === me.user.facilityId)).toBe(true);
  }
});
