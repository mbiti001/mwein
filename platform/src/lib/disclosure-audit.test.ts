import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("./audit", async importOriginal => ({ ...await importOriginal<typeof import("./audit")>(), appendAudit: vi.fn() }));
import { db } from "./db";
import { appendAudit } from "./audit";
import { recordDisclosure } from "./disclosure-audit";
const actor = { id: "actor", facilityId: "facility", sessionId: "session" };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({})); });
describe("sensitive disclosure audit", () => {
  it("retains actor attribution and fingerprints without raw patient ids or report data", async () => {
    await recordDisclosure(actor, "REFERRALS", ["private-patient-id"]);
    await recordDisclosure(actor, "MONTHLY_REPORT", [], { diagnosis: "Private diagnosis", total: 1 });
    const events = vi.mocked(appendAudit).mock.calls.map(call => call[1]);
    for (const event of events) expect(event).toMatchObject({ userId: "actor", facilityId: "facility", sessionId: "session", action: "SENSITIVE_DATA_ACCESSED" });
    expect(JSON.stringify(events)).not.toContain("private-patient-id");
    expect(JSON.stringify(events)).not.toContain("Private diagnosis");
  });
  it("propagates persistence failure", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("unavailable"));
    await expect(recordDisclosure(actor, "PATIENT_PROBLEMS", [])).rejects.toThrow("unavailable");
  });
});
