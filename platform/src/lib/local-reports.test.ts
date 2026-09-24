import { describe, expect, it } from "vitest";
import { localReportPayload, localReportHash, requireCompleteLocalReport, assertLocalReportTransition } from "./local-reports";
const payload = { sourceReference: "Synthetic register", zeroConfirmed: false, rows: [{ indicator: "Visits", count: 2 }] };
describe("local report review safeguards", () => {
  it("distinguishes missing data, zero activity and nonzero activity", () => {
    expect(() => requireCompleteLocalReport({ ...payload, rows: [{ indicator: "Visits", count: null }] })).toThrow("Missing counts");
    expect(() => requireCompleteLocalReport({ ...payload, rows: [{ indicator: "Visits", count: 0 }] })).toThrow("Confirm zero");
    expect(() => requireCompleteLocalReport({ ...payload, zeroConfirmed: true, rows: [{ indicator: "Visits", count: 0 }] })).not.toThrow();
    expect(() => requireCompleteLocalReport(payload)).not.toThrow();
  });
  it("rejects contradictory zero claims, duplicate indicators and invalid counts", () => {
    expect(localReportPayload.safeParse({ ...payload, zeroConfirmed: true }).success).toBe(false);
    expect(localReportPayload.safeParse({ ...payload, rows: [...payload.rows, { indicator: " visits ", count: 1 }] }).success).toBe(false);
    for (const count of [-1, 0.1, Infinity, 100000001]) expect(localReportPayload.safeParse({ ...payload, rows: [{ indicator: "Visits", count }] }).success).toBe(false);
  });
  it("binds the month, source and indicator counts into the revision hash", () => {
    const hash = localReportHash("2026-09", payload);
    expect(localReportHash("2026-10", payload)).not.toBe(hash);
    expect(localReportHash("2026-09", { ...payload, sourceReference: "Other register" })).not.toBe(hash);
    expect(localReportHash("2026-09", { ...payload, rows: [{ indicator: "Visits", count: 3 }] })).not.toBe(hash);
    expect(localReportHash("2026-09", { rows: payload.rows, zeroConfirmed: false, sourceReference: payload.sourceReference })).toBe(hash);
  });
  it("freezes approved reports and forbids contributors approving their own work", () => {
    expect(() => assertLocalReportTransition("APPROVED", "SAVE", [], "reviewer")).toThrow("unavailable");
    expect(() => assertLocalReportTransition("DRAFT", "APPROVE", [], "reviewer")).toThrow("unavailable");
    expect(() => assertLocalReportTransition("IN_REVIEW", "APPROVE", ["earlier-editor", "current-editor"], "earlier-editor")).toThrow("did not prepare");
    expect(() => assertLocalReportTransition("IN_REVIEW", "APPROVE", ["editor"], "reviewer")).not.toThrow();
    expect(() => assertLocalReportTransition("APPROVED", "CORRECT", ["editor"], "editor")).not.toThrow();
  });
});
