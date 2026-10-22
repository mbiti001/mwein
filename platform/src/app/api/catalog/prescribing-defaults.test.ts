import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn(), catalogItem: { findFirst: vi.fn(), findMany: vi.fn() } } }));
vi.mock("@/lib/audit", async () => ({ ...await vi.importActual("@/lib/audit"), appendAudit: vi.fn() }));
vi.mock("@/lib/audited-json", () => ({ auditedOperationalJson: vi.fn(async (_user, _entity, body) => Response.json(body)) }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { GET, POST, PATCH } from "./route";
const actor = { id: "actor-a", sessionId: "session-a", facilityId: "facility-a" };
const defaults = { route: "Oral", frequencyPerDay: 2, durationDays: 3, doseUnit: "tablet", doseUnitsPerIssueUnit: 1, wholeIssueUnits: false };
const item = { category: "PHARMACEUTICAL", code: "SYNTH-RX", name: "Synthetic medicine", genericName: "Synthetic", strength: "1 mg", dosageForm: "Tablet", unitOfMeasure: "tablet", unitPrice: 5, prescribingDefaults: defaults };
const id = "00000000-0000-4000-8000-000000000001";
const req = (body: object) => new Request("http://localhost/api/catalog", { method: "POST", body: JSON.stringify(body) });
let tx: any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as never);
  tx = { catalogItem: { create: vi.fn(async ({data}) => ({id, ...data})), update: vi.fn() }, catalogPriceVersion: { create: vi.fn() } };
  vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn(tx));
});
describe("facility medicine default configuration boundary", () => {
  it("requires catalogue administration and captures actor/session/facility plus the full configuration fingerprint", async () => {
    const response = await POST(req(item));
    expect(response.status).toBe(201);
    expect(requirePermission).toHaveBeenCalledWith("admin.catalog");
    expect(tx.catalogItem.create).toHaveBeenCalledWith({data:expect.objectContaining({facilityId:actor.facilityId, prescribingDefaults:defaults})});
    const created = (await response.json()).item;
    expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ facilityId: actor.facilityId, sessionId: actor.sessionId, userId: actor.id, afterHash: auditValueFingerprint(created) }));
  });
  it("does not mutate when permission is denied", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Forbidden"), {status:403}));
    expect((await POST(req(item))).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("cannot update another facility's configuration", async () => {
    vi.mocked(db.catalogItem.findFirst).mockResolvedValue(null);
    expect((await PATCH(req({...item,id}))).status).toBe(404);
    expect(db.catalogItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id, facilityId:actor.facilityId}}));
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("returns only the authenticated facility catalogue", async () => {
    vi.mocked(db.catalogItem.findMany).mockResolvedValue([]);
    expect((await GET(new Request("http://localhost/api/catalog"))).status).toBe(200);
    expect(db.catalogItem.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{facilityId:actor.facilityId}}));
  });
  it.each([{...defaults,doseUnitsPerIssueUnit:0}, {...defaults,frequencyPerDay:0}, {...defaults,durationDays:1.5}, {...defaults,doseUnit:""}])("rejects invalid or incomplete conversion configuration", async prescribingDefaults => {
    expect((await POST(req({...item,prescribingDefaults}))).status).toBe(422);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("does not report success when the audit append fails", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("Synthetic audit failure"));
    const response = await POST(req(item));
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("item");
  });
});
