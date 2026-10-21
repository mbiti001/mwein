import { describe, expect, it } from "vitest";
import { addendumAuditFingerprint } from "./addendum-audit";

const record = { id: "note", encounterId: "encounter", authorId: "author", reason: "Clarification", text: "Saved narrative", createdAt: "2026-10-21T08:00:00.000Z" };
describe("persisted addendum fingerprint", () => {
  it.each(["id", "encounterId", "authorId", "reason", "text", "createdAt"])("binds %s", key => {
    const changed = { ...record, [key]: key === "createdAt" ? "2026-10-21T08:01:00Z" : "changed" };
    expect(addendumAuditFingerprint("facility", "visit", changed)).not.toBe(addendumAuditFingerprint("facility", "visit", record));
  });
  it("binds facility and visit and normalizes only timestamp representation", () => {
    const hash = addendumAuditFingerprint("facility", "visit", record);
    expect(addendumAuditFingerprint("other", "visit", record)).not.toBe(hash);
    expect(addendumAuditFingerprint("facility", "other", record)).not.toBe(hash);
    expect(addendumAuditFingerprint("facility", "visit", { ...record, createdAt: new Date(record.createdAt) })).toBe(hash);
    expect(addendumAuditFingerprint("facility", "visit", { ...record, text: record.text + " " })).not.toBe(hash);
  });
});
