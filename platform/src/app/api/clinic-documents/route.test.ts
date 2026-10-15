import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { clinicDocument: { findMany: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn(), auditValueFingerprint: vi.fn(() => "hash") }));
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { db } from "@/lib/db";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { GET, POST, PATCH } from "./route";
const user = { id: "actor", facilityId: "facility-a", sessionId: "session", facility: { code: "MMS", name: "Synthetic clinic", timezone: "Africa/Nairobi" } };
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

describe("numbered document creation and durable replay", () => {
  function transaction() {
    const tx = { clinicDocument: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(async ({ data }) => ({ ...data, status: "DRAFT" })) }, visit: { findFirst: vi.fn().mockResolvedValue({ id, visitNumber: "MMS-V-2026-000001", patient: { fullName: "Synthetic patient", patientNumber: "MMS-P-2026-000001" } }) }, referenceSequence: { upsert: vi.fn().mockResolvedValue({ nextValue: 2n }) } };
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn(tx));
    vi.mocked(auditValueFingerprint).mockImplementation(value => JSON.stringify(value));
    return tx;
  }
  const input = { kind: "SICK", visitId: id, payload: {}, requestKey: "22222222-2222-4222-8222-222222222222" };
  it("creates reference and receipt inside the audited serializable transaction without disclosing receipt secrets", async () => {
    const tx = transaction();
    const response = await POST(request(input, "POST"));
    expect(response.status).toBe(201);
    const body = await response.json(); expect(body.document.reference).toMatch(/^MMS-SICK-\d{4}-000001$/);
    expect(body.document).not.toHaveProperty("creationKey"); expect(body.document).not.toHaveProperty("creationHash");
    expect(tx.visit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facilityId: user.facilityId }) }));
    expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: user.id, sessionId: user.sessionId, action: "CLINIC_DOCUMENT_CREATED" }));
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
  });
  it("does not allocate or audit-create for a foreign visit", async () => {
    const tx = transaction(); tx.visit.findFirst.mockResolvedValue(null as any);
    expect((await POST(request(input, "POST"))).status).toBe(422);
    expect(tx.referenceSequence.upsert).not.toHaveBeenCalled(); expect(tx.clinicDocument.create).not.toHaveBeenCalled();
  });
  it("confirms the same request after edits without allocating again, and rejects changed intent or actor", async () => {
    const tx = transaction(); await POST(request(input, "POST"));
    const saved = tx.clinicDocument.create.mock.calls[0][0].data;
    tx.clinicDocument.findUnique.mockResolvedValue({ ...saved, payload: { recommendation: "Later saved edits" }, status: "DRAFT" } as any);
    const response = await POST(request(input, "POST"));
    expect(response.status).toBe(200); expect((await response.json()).replayed).toBe(true);
    expect(tx.referenceSequence.upsert).toHaveBeenCalledTimes(1);
    expect((await POST(request({ ...input, payload: { recommendation: "Different create" } }, "POST"))).status).toBe(409);
    vi.mocked(requirePermission).mockResolvedValue({ ...user, id: "different-actor" } as any);
    expect((await POST(request(input, "POST"))).status).toBe(409);
    expect(tx.clinicDocument.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId_creationKey: { facilityId: user.facilityId, creationKey: input.requestKey } } }));
  });
  it("fails the transaction when audit history cannot be committed", async () => {
    transaction(); vi.mocked(appendAudit).mockRejectedValue(new Error("audit unavailable"));
    const response = await POST(request(input, "POST")); expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("document");
  });
});
