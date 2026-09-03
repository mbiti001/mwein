import { describe, expect, it } from "vitest";
import { appointmentReminder } from "./reminders";

describe("appointment reminders", () => {
  it("creates a concise reminder without clinical details", () => {
    const message = appointmentReminder({
      patientName: "Amina Wanjiku",
      facilityName: "Mwein Medical Services",
      clinic: "Outpatient",
      scheduledAt: new Date("2026-09-04T10:30:00+03:00"),
    });
    expect(message).toContain("Hello Amina");
    expect(message).toContain("Outpatient appointment");
    expect(message).not.toContain("diagnosis");
  });
});
