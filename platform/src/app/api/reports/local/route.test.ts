import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { localReportRevision: { findMany: vi.fn() }, $transaction: vi.fn() } }));
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { db } from "@/lib/db";
import { GET, POST, PATCH } from "./route";
const user = { id: "actor", facilityId: "facility-a", sessionId: "session" };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(user as any); vi.mocked(db.localReportRevision.findMany).mockResolvedValue([]); });
describe("local reporting boundaries", () => {
  it("scopes reads to facility and month, records disclosure and forbids caching", async () => {
    const response = await GET(new Request("http://localhost/api/reports/local?month=2026-09"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(db.localReportRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: user.facilityId, month: "2026-09" } }));
    expect(recordDisclosure).toHaveBeenCalledWith(user, "LOCAL_REPORT", [], expect.objectContaining({ submissionStatus: "NOT_SUBMITTED" }));
  });
  it("withholds records when disclosure auditing fails", async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("audit unavailable"));
    const response = await GET(new Request("http://localhost/api/reports/local?month=2026-09"));
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("reports");
  });
  it("denies unauthenticated reads and mutations before database access", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    for (const handler of [GET, POST, PATCH]) expect((await handler(new Request("http://localhost/api/reports/local?month=2026-09"))).status).toBe(403);
    expect(db.localReportRevision.findMany).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("prevents a review request from smuggling a changed payload", async () => {
    const response = await PATCH(new Request("http://localhost/api/reports/local", { method: "PATCH", body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", version: 1, action: "APPROVE", reason: "Reviewed", payload: { sourceReference: "Synthetic", zeroConfirmed: false, rows: [{ indicator: "Visits", count: 1 }] } }) }));
    expect(response.status).toBe(422); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("hides foreign-facility records from mutations", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ localReportRevision: { findFirst } }));
    const response = await PATCH(new Request("http://localhost/api/reports/local", { method: "PATCH", body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", version: 1, action: "REQUEST_REVIEW", reason: "Ready" }) }));
    expect(response.status).toBe(404); expect(findFirst).toHaveBeenCalledWith({ where: { id: "11111111-1111-4111-8111-111111111111", facilityId: user.facilityId } });
  });
});
