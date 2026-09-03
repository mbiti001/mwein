import { describe, expect, it } from "vitest";
import { appointmentCanBeBooked } from "./appointments";

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
