import { describe, expect, it } from "vitest";
import { currentServicePoint, isWaitingOverdue, servicePointCounts, waitingMinutes } from "./service-points";

const patient = { fullName: "Test Patient", patientNumber: "P-1" };

describe("service point mapping", () => {
  it("uses the active queue as the source of truth", () => {
    expect(currentServicePoint({ id: "1", status: "AWAITING_RESULTS", priority: "ROUTINE", arrivedAt: "2026-09-03T06:00:00Z", patient, queues: [{ servicePoint: "IMAGING", status: "WAITING" }] })).toBe("IMAGING");
  });

  it("falls back to the visit status for older records", () => {
    expect(currentServicePoint({ id: "1", status: "AWAITING_PAYMENT", priority: "ROUTINE", arrivedAt: "2026-09-03T06:00:00Z", patient })).toBe("BILLING");
  });

  it("summarizes queues and calculates non-negative waiting time", () => {
    const visits = [{ id: "1", status: "AWAITING_TRIAGE", priority: "ROUTINE", arrivedAt: "2026-09-03T06:00:00Z", patient }];
    expect(servicePointCounts(visits).TRIAGE).toBe(1);
    expect(waitingMinutes(visits[0], new Date("2026-09-03T06:15:00Z"))).toBe(15);
  });

  it("escalates emergency and urgent waits sooner than routine queues", () => {
    expect(isWaitingOverdue("EMERGENCY", 1)).toBe(true);
    expect(isWaitingOverdue("URGENT", 9)).toBe(false);
    expect(isWaitingOverdue("ROUTINE", 30)).toBe(true);
  });
});
