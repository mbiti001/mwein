import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { visit: { findMany: vi.fn() } } }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { GET } from "./route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue({ facilityId: "facility-a" } as never); vi.mocked(db.visit.findMany).mockResolvedValue([]); });
describe("focused clinical record", () => {
  it("requires clinical access and scopes the exact visit to the signed-in facility", async () => {
    const response = await GET(new Request(`http://localhost/api/visit-summaries?visitId=${id}`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requirePermission).toHaveBeenCalledWith("clinical.summary.read");
    expect(db.visit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: "facility-a", id } }));
    expect(await response.json()).toEqual({ summaries: [] });
    expect(recordClinicalAccess).toHaveBeenCalled();
  });
  it("rejects malformed visit identifiers before reading records", async () => {
    expect((await GET(new Request("http://localhost/api/visit-summaries?visitId=not-a-visit"))).status).toBe(422);
    expect(db.visit.findMany).not.toHaveBeenCalled();
  });
  it("preserves the clinical access gate even for a known visit", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    expect((await GET(new Request(`http://localhost/api/visit-summaries?visitId=${id}`))).status).toBe(403);
    expect(db.visit.findMany).not.toHaveBeenCalled();
  });
});
