import { describe, expect, it } from "vitest";
import { assessmentAuditFingerprint } from "./assessment-audit";

const record = { id: "record-a", encounterId: "encounter-a", servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0",
  data: { carePlan: "Synthetic plan", negative: false, zero: "0", empty: "", nested: { b: 2, a: [true, null, "é"] } },
  riskLevel: "ROUTINE", followUpAt: new Date("2026-10-22T00:00:00Z"), updatedById: "actor-a", updatedAt: new Date("2026-10-21T00:00:00Z") };
const hash = (value = record, facility = "facility-a", visit = "visit-a") => assessmentAuditFingerprint(facility, visit, value);

describe("persisted assessment audit fingerprint", () => {
  it("ignores recursive object insertion order and normalizes Date/string timestamps", () => {
    const reordered = { ...record, data: { nested: { a: [true, null, "é"], b: 2 }, empty: "", zero: "0", negative: false, carePlan: "Synthetic plan" } };
    expect(hash(reordered)).toBe(hash());
    expect(assessmentAuditFingerprint("facility-a", "visit-a", { ...reordered, followUpAt: record.followUpAt.toISOString(), updatedAt: record.updatedAt.toISOString() })).toBe(hash());
  });
  it.each([
    ["value", { data: { ...record.data, carePlan: "Changed plan" } }],
    ["false", { data: { ...record.data, negative: true } }],
    ["missing", { data: { ...record.data, additional: "" } }],
    ["scalar type", { data: { ...record.data, zero: 0 } }],
    ["array order", { data: { ...record.data, nested: { b: 2, a: [null, true, "é"] } } }],
    ["risk", { riskLevel: "HIGH" }], ["legacy null risk", { riskLevel: null }], ["follow-up", { followUpAt: null }],
    ["template", { templateVersion: "KE-WALKIN-2.0" }], ["service", { servicePoint: "ANC" }],
    ["record", { id: "record-b" }], ["encounter", { encounterId: "encounter-b" }],
    ["recorder", { updatedById: "actor-b" }], ["revision time", { updatedAt: new Date("2026-10-21T01:00:00Z") }],
  ])("binds %s without exposing raw content", (_label, patch) => {
    const changed = assessmentAuditFingerprint("facility-a", "visit-a", { ...record, ...patch });
    expect(changed).not.toBe(hash());
    expect(changed).toMatch(/^assessment-v1:[a-f0-9]{64}$/);
  });
  it("binds facility and visit and distinguishes a first save from an empty record", () => {
    expect(hash(record, "facility-b")).not.toBe(hash());
    expect(hash(record, "facility-a", "visit-b")).not.toBe(hash());
    const absent = assessmentAuditFingerprint("facility-a", "visit-a", null);
    expect(absent).not.toBe(assessmentAuditFingerprint("facility-a", "visit-a", { ...record, data: {} }));
    expect(absent).not.toBe(assessmentAuditFingerprint("facility-b", "visit-a", null));
  });
});
