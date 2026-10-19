import { describe, expect, it } from "vitest";
import { assessmentRevision } from "./assessment-revision";

const encounter = { id: "encounter", status: "DRAFT", updatedAt: new Date("2026-10-19T20:00:00Z") };
const record = { id: "record", templateVersion: "KE-WALKIN-1.0", updatedAt: new Date("2026-10-19T20:00:01Z") };
describe("assessment observed-state revision", () => {
  it("distinguishes no encounter from an encounter without an assessment", () => {
    expect(assessmentRevision("visit", null)).toBeNull();
    expect(assessmentRevision("visit", encounter)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("normalizes database and HTTP date representations", () => {
    expect(assessmentRevision("visit", encounter, record)).toBe(assessmentRevision("visit", { ...encounter, updatedAt: encounter.updatedAt.toISOString() }, { ...record, updatedAt: record.updatedAt.toISOString() }));
  });
  it.each([
    ["another-visit", encounter, record],
    ["visit", { ...encounter, id: "replacement" }, record],
    ["visit", { ...encounter, status: "SIGNED" }, record],
    ["visit", { ...encounter, updatedAt: new Date("2026-10-19T20:00:02Z") }, record],
    ["visit", encounter, null],
    ["visit", encounter, { ...record, id: "replacement" }],
    ["visit", encounter, { ...record, templateVersion: "KE-WALKIN-2.0" }],
    ["visit", encounter, { ...record, updatedAt: new Date("2026-10-19T20:00:02Z") }],
  ] as const)("changes with visit, encounter or assessment identity/state: %s %j %j", (visitId, candidateEncounter, candidateRecord) => {
    expect(assessmentRevision(visitId, candidateEncounter, candidateRecord)).not.toBe(assessmentRevision("visit", encounter, record));
  });
});
