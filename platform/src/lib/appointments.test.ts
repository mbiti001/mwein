import { describe, expect, it } from "vitest";
import { appointmentCanBeBooked, appointmentWindow, kenyaAppointmentInput } from "./appointments";

describe("appointment booking rules", () => {
  const now = new Date("2026-09-03T09:00:00+03:00");

  it("accepts a future appointment within 90 days", () => {
    expect(appointmentCanBeBooked(new Date("2026-09-04T10:00:00+03:00"), now)).toBe(true);
  });

  it("rejects past and excessively distant appointments", () => {
    expect(appointmentCanBeBooked(new Date("2026-09-03T08:59:00+03:00"), now)).toBe(false);
    expect(appointmentCanBeBooked(new Date("2026-12-10T10:00:00+03:00"), now)).toBe(false);
  });
});

describe("Nairobi appointment worklists", () => {
  const midnight = new Date("2026-10-14T22:00:00Z");
  it("keeps earlier appointments on the local day visible after their time passes", () => {
    expect(appointmentWindow("today", midnight)).toEqual({ gte: new Date("2026-10-14T21:00:00Z"), lt: new Date("2026-10-15T21:00:00Z") });
  });
  it("starts upcoming at tomorrow and retains the full booking horizon in all", () => {
    expect(appointmentWindow("upcoming", midnight).gte).toEqual(appointmentWindow("today", midnight).lt);
    expect(appointmentWindow("all", midnight).lt.getTime()).toBeGreaterThan(midnight.getTime() + 90 * 86400000);
  });
  it("recalls only elapsed times and formats inputs independently of the workstation timezone", () => {
    expect(appointmentWindow("recall", midnight).lt).toEqual(midnight);
    expect(kenyaAppointmentInput(midnight)).toBe("2026-10-15T01:00");
  });
});
