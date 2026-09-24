import { describe, expect, it } from "vitest";
import { assertSurveillanceAction, manualNotification, surveillanceChange, surveillanceDetails, surveillanceHash } from "./surveillance";
const details = { kind: "CASE", patientId: null, concern: "Synthetic concern", description: "Synthetic observation", location: "Test location", detectedAt: "2026-01-01T09:00:00Z", onsetAt: null, priority: "UNASSESSED" };
describe("local surveillance controls", () => {
  it("allows unidentified cases and patient-free events without a diagnosis code", () => {
    expect(surveillanceDetails.safeParse(details).success).toBe(true);
    expect(surveillanceDetails.safeParse({ ...details, kind: "EVENT" }).success).toBe(true);
    expect(surveillanceDetails.safeParse({ ...details, kind: "EVENT", patientId: "11111111-1111-4111-8111-111111111111" }).success).toBe(false);
  });
  it("rejects future observations and unsupported clinical classifications", () => {
    expect(surveillanceDetails.safeParse({ ...details, detectedAt: "2100-01-01T00:00:00Z" }).success).toBe(false);
    expect(surveillanceDetails.safeParse({ ...details, nationalCaseClassification: "CONFIRMED" }).success).toBe(false);
  });
  it("requires assessed priority for review but never review before notification", () => {
    expect(() => assertSurveillanceAction("OPEN", "REVIEW", "UNASSESSED")).toThrow("assessed");
    for (const state of ["OPEN", "REVIEWED", "CLOSED"]) expect(() => assertSurveillanceAction(state, "NOTIFY", "UNASSESSED")).not.toThrow();
    expect(() => assertSurveillanceAction("OPEN", "CLOSE", "URGENT")).toThrow("unavailable");
    expect(() => assertSurveillanceAction("CLOSED", "UPDATE", "URGENT")).toThrow("unavailable");
    expect(() => assertSurveillanceAction("CLOSED", "REOPEN", "URGENT")).not.toThrow();
  });
  it("requires concrete manual notification evidence, not an automatic success flag", () => {
    const notification = { notifiedAt: "2026-01-01T09:00:00Z", recipient: "Synthetic county office", channel: "PHONE", outcome: "ATTEMPTED", evidenceReference: "Protected test call log" };
    expect(manualNotification.safeParse(notification).success).toBe(true);
    expect(manualNotification.safeParse({ ...notification, outcome: "VERIFIED_ACCEPTED" }).success).toBe(false);
    expect(manualNotification.safeParse({ ...notification, evidenceReference: "" }).success).toBe(false);
  });
  it("rejects payload smuggling on review and preserves canonical hashes after JSONB ordering", () => {
    expect(surveillanceChange.safeParse({ id: "11111111-1111-4111-8111-111111111111", version: 1, reason: "Review", action: "REVIEW", details }).success).toBe(false);
    expect(surveillanceHash({ b: { x: 1, a: 2 }, a: 3 })).toBe(surveillanceHash({ a: 3, b: { a: 2, x: 1 } }));
    expect(surveillanceHash({ count: 1 })).not.toBe(surveillanceHash({ count: 2 }));
  });
});
