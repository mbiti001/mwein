import { describe, expect, it } from "vitest";
import { isIsoCalendarDate, summarizeOperations } from "./reporting";

describe("report dates", () => {
  it("accepts real ISO calendar dates and rejects normalized dates", () => {
    expect(isIsoCalendarDate("2026-09-03")).toBe(true);
    expect(isIsoCalendarDate("2026-02-29")).toBe(false);
    expect(isIsoCalendarDate("2026-13-01")).toBe(false);
  });
});

describe("operational reporting", () => {
  it("summarizes visit, billing and confirmed-payment totals", () => {
    const report = summarizeOperations([
      {
        priority: "EMERGENCY",
        status: "COMPLETED",
        invoice: {
          items: [{ quantity: "2", unitPrice: "500" }],
          payments: [
            { amount: "600", status: "CONFIRMED" },
            { amount: "100", status: "REVERSED" },
          ],
          claims: [],
        },
      },
    ]);
    expect(report).toMatchObject({
      visits: 1,
      completedVisits: 1,
      emergencyVisits: 1,
      billed: 1000,
      received: 600,
      outstanding: 400,
    });
  });

  it("identifies rejected and stale submitted claims", () => {
    const report = summarizeOperations(
      [
        {
          priority: "ROUTINE",
          status: "AWAITING_PAYMENT",
          invoice: {
            items: [],
            payments: [],
            claims: [
              { id: "1", claimNumber: "CLM-1", payer: "SHA", amount: 500, status: "REJECTED", updatedAt: "2026-09-02" },
              { id: "2", claimNumber: "CLM-2", payer: "SHA", amount: 700, status: "SUBMITTED", updatedAt: "2026-08-20" },
              { id: "3", claimNumber: "CLM-3", payer: "SHA", amount: 900, status: "APPROVED", updatedAt: "2026-08-01" },
            ],
          },
        },
      ],
      new Date("2026-09-03T12:00:00Z"),
    );
    expect(report.claimExceptions.map((claim) => claim.id)).toEqual(["1", "2"]);
  });
});
