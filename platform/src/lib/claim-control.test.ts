import { describe, expect, it } from "vitest";
import { addWorkingDays, claimControlSummary } from "./claim-control";

describe("SHA claims control centre", () => {
  it("calculates the seven-working-day review window", () => {
    expect(addWorkingDays("2026-09-11T08:00:00Z", 7).toISOString()).toBe("2026-09-22T23:59:59.999Z");
  });

  it("surfaces overdue submission and urgent correction claims", () => {
    const summary = claimControlSummary([
      { id: "1", claimNumber: "CLM-1", patientName: "A", patientNumber: "P1", amount: 1000, status: "DRAFT", submissionDeadline: "2026-09-13T23:59:59Z", updatedAt: "2026-09-10T00:00:00Z" },
      { id: "2", claimNumber: "CLM-2", patientName: "B", patientNumber: "P2", amount: 2000, status: "RETURNED", updatedAt: "2026-09-01T00:00:00Z" },
    ], new Date("2026-09-14T12:00:00Z"));
    expect(summary.alerts.map(item => item.severity)).toEqual(["OVERDUE", "URGENT"]);
    expect(summary.corrections).toBe(1);
  });
});
