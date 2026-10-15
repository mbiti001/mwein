import { describe, expect, it } from "vitest";
import { canTransitionDataSubjectRequest, rightsRequestDueAt, rightsRequestIsOverdue } from "./privacy";

describe("rights request response targets", () => {
  it.each([["ACCESS", 7], ["CORRECTION", 14], ["PORTABLE_EXPORT", 30], ["DISCLOSURE", 7]] as const)("calculates %s from receipt across month boundaries", (type, days) => {
    const receipt = new Date("2026-01-29T12:30:00+03:00");
    expect(rightsRequestDueAt(type, receipt).getTime() - receipt.getTime()).toBe(days * 86_400_000);
    expect(receipt.toISOString()).toBe("2026-01-29T09:30:00.000Z");
  });
  it("does not restart the overdue clock for verification/review or mark closed requests outstanding", () => {
    const due = "2026-01-01T00:00:00Z";
    const now = new Date("2026-02-01T00:00:00Z");
    for (const status of ["RECEIVED", "IDENTITY_VERIFIED", "IN_REVIEW"]) expect(rightsRequestIsOverdue(status, due, now)).toBe(true);
    for (const status of ["COMPLETED", "DENIED", "CANCELLED"]) expect(rightsRequestIsOverdue(status, due, now)).toBe(false);
    expect(rightsRequestIsOverdue("RECEIVED", "2026-03-01T00:00:00Z", now)).toBe(false);
  });
});

describe("data-subject request transitions", () => {
  it("requires identity verification before review", () => {
    expect(canTransitionDataSubjectRequest("RECEIVED", "IDENTITY_VERIFIED")).toBe(true);
    expect(canTransitionDataSubjectRequest("RECEIVED", "IN_REVIEW")).toBe(false);
  });

  it("does not reopen a terminal request", () => {
    expect(canTransitionDataSubjectRequest("COMPLETED", "IN_REVIEW")).toBe(false);
    expect(canTransitionDataSubjectRequest("DENIED", "RECEIVED")).toBe(false);
  });
});
