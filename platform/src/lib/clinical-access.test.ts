import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("./audit", () => ({ appendAudit: vi.fn() }));

import { db } from "./db";
import { appendAudit } from "./audit";
import { recordClinicalAccess } from "./clinical-access";

const actor = { id: "actor-id", facilityId: "facility-id", sessionId: "session-id" };

describe("clinical disclosure auditing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback({}));
  });

  it("records actor, facility, session and deduplicated references without clinical content", async () => {
    const record = { type: "Patient" as const, id: "patient-id", fullName: "Private name", notes: "Private notes" };
    await recordClinicalAccess(actor, "PATIENT_SEARCH", [record, record]);
    expect(appendAudit).toHaveBeenCalledOnce();
    const event = vi.mocked(appendAudit).mock.calls[0][1];
    expect(event).toMatchObject({
      userId: actor.id, facilityId: actor.facilityId, sessionId: actor.sessionId,
      action: "CLINICAL_RECORDS_ACCESSED", entityType: "Patient", entityId: "patient-id",
    });
    expect(JSON.parse(event.reason!)).toEqual({
      version: 1, context: "PATIENT_SEARCH", outcome: "AUTHORISED_DISCLOSURE",
      resources: [{ type: "Patient", id: "patient-id" }],
    });
    expect(JSON.stringify(event)).not.toContain("Private");
  });

  it("records a list in one transaction and keeps empty searches traceable without logging the query", async () => {
    await recordClinicalAccess(actor, "VISIT_SUMMARIES", [{ type: "Visit", id: "v1" }, { type: "Visit", id: "v2" }]);
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(vi.mocked(appendAudit).mock.calls[0][1].entityType).toBe("ClinicalRecordSet");
    await recordClinicalAccess(actor, "PATIENT_SEARCH", []);
    expect(JSON.parse(vi.mocked(appendAudit).mock.calls[1][1].reason!).resources).toEqual([]);
  });

  it("propagates audit failure so callers cannot silently disclose records", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("Audit unavailable"));
    await expect(recordClinicalAccess(actor, "PATIENT_HISTORY", [{ type: "Patient", id: "p1" }])).rejects.toThrow("Audit unavailable");
  });
});
