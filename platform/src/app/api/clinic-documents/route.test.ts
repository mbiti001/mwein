import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { clinicDocument: { findMany: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn(), auditValueFingerprint: vi.fn(() => "hash") }));
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { db } from "@/lib/db";
import { GET, POST, PATCH } from "./route";
const user = { id: "actor", facilityId: "facility-a", sessionId: "session" };
const id = "11111111-1111-4111-8111-111111111111";
const request = (body: object, method = "PATCH") => new Request("http://localhost/api/clinic-documents?kind=SICK", { method, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(user as any); vi.mocked(db.clinicDocument.findMany).mockResolvedValue([]); });
describe("clinic document access and signing boundaries", () => {
  it("scopes disclosed records to facility and document authority without caching", async () => {
    const response = await GET(new Request("http://localhost/api/clinic-documents?kind=SICK"));
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("encounter.write");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(db.clinicDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: user.facilityId, kind: "SICK" } }));
    expect(recordDisclosure).toHaveBeenCalledWith(user, "CLINIC_DOCUMENT", []);
  });
  it("withholds records when disclosure auditing fails", async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("audit unavailable"));
    const response = await GET(new Request("http://localhost/api/clinic-documents?kind=SICK"));
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("documents");
  });
  it("denies unauthorized authoring before database access", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    expect((await POST(request({ kind: "SICK", visitId: id, payload: {} }, "POST"))).status).toBe(403);
    expect((await PATCH(request({ id, kind: "SICK", version: 1, action: "SIGN", attested: true }))).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("hides foreign facility documents from mutations", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ clinicDocument: { findFirst } }));
    expect((await PATCH(request({ id, kind: "SICK", version: 1, action: "SIGN", attested: true }))).status).toBe(404);
    expect(findFirst).toHaveBeenCalledWith({ where: { id, facilityId: user.facilityId, kind: "SICK" } });
  });
  it("refuses unsigned attestations, payload smuggling and stale signing without writes", async () => {
    const updateMany = vi.fn();
    const findFirst = vi.fn().mockResolvedValue({ id, status: "DRAFT", version: 1 });
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ clinicDocument: { findFirst, updateMany } }));
    for (const extra of [{}, { attested: true, payload: {} }]) expect((await PATCH(request({ id, kind: "SICK", version: 1, action: "SIGN", ...extra }))).status).toBe(422);
    expect((await PATCH(request({ id, kind: "SICK", version: 2, action: "SIGN", attested: true }))).status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
