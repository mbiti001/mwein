import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { SupplyDocument } from "@/lib/supply-documents";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  goodsReceipt: { findFirst: vi.fn(), findMany: vi.fn() },
  purchaseOrder: { findFirst: vi.fn(), findMany: vi.fn() },
  catalogItem: { findMany: vi.fn() }, user: { findMany: vi.fn() },
} }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { GET, POST } from "./route";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = { id: "receiver", facilityId: "facility", sessionId: "session" };
const snapshot: SupplyDocument = {
  version: 1, kind: "GOODS_RECEIPT", reference: "GRN-ORIGINAL", facilityName: "Mwein Medical Services", facilityCode: "MMS", status: "POSTED", date: "2026-10-15T08:00:00.000Z",
  supplier: { name: "Original supplier", code: "SUP", phone: null, email: null }, orderNumber: "PO-1", expectedAt: null, notes: null, cancellationReason: null,
  actors: [{ label: "Received by", name: "Original receiver", at: "2026-10-15T08:00:00.000Z" }],
  lines: [{ code: "PARA", name: "Original item", quantity: "3", unitCost: "2.50", total: "7.50", batchNumber: "B-1", expiryDate: "2028-01-01", storeName: "Main pharmacy" }], total: "7.50",
};
function request(kind = "GOODS_RECEIPT", intent = "PREVIEW") {
  return new Request("http://localhost/api/supply/documents", { method: "POST", body: JSON.stringify({ kind, intent, id }) });
}
describe("supply document disclosure", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue(actor as never);
    vi.mocked(db.goodsReceipt.findFirst).mockResolvedValue({ snapshot } as never);
  });
  it("returns the retained receipt without reading mutable supplier, stock or staff data", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ document: snapshot });
    expect(requirePermission).toHaveBeenCalledWith("inventory.view");
    expect(db.goodsReceipt.findFirst).toHaveBeenCalledWith({ where: { id, facilityId: actor.facilityId }, select: { snapshot: true } });
    expect(db.purchaseOrder.findFirst).not.toHaveBeenCalled();
    expect(db.catalogItem.findMany).not.toHaveBeenCalled();
    expect(recordDisclosure).toHaveBeenCalledWith(actor, "OPERATIONS_READ:supply-document-preview", [id], snapshot);
  });
  it("withholds receipt contents if the print audit fails", async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("Audit unavailable"));
    const response = await POST(request("GOODS_RECEIPT", "PRINT"));
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("document");
    expect(recordDisclosure).toHaveBeenCalledWith(actor, "OPERATIONS_READ:supply-document-print", [id], snapshot);
  });
  it("does not disclose an unavailable or foreign-facility document", async () => {
    vi.mocked(db.goodsReceipt.findFirst).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404);
    expect(recordDisclosure).not.toHaveBeenCalled();
  });
  it("denies both list and preview before querying documents", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    expect((await GET()).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(db.goodsReceipt.findFirst).not.toHaveBeenCalled();
    expect(db.purchaseOrder.findMany).not.toHaveBeenCalled();
  });
  it("resolves cancellation and partial quantities afresh for a print request", async () => {
    vi.mocked(db.purchaseOrder.findFirst).mockResolvedValue({
      id, orderNumber: "PO-1", status: "CANCELLED", createdAt: new Date(snapshot.date), facility: { name: snapshot.facilityName, code: "MMS" }, supplier: snapshot.supplier,
      createdById: "maker", submittedById: null, submittedAt: null, approvedById: null, approvedAt: null, cancelledById: "checker", cancelledAt: new Date(snapshot.date), cancellationReason: "Supplier unable to deliver", expectedAt: null, notes: null,
      lines: [{ catalogItemId: "item", quantityOrdered: new Prisma.Decimal(10), quantityReceived: new Prisma.Decimal(3), unitCost: new Prisma.Decimal("2.55") }],
    } as never);
    vi.mocked(db.catalogItem.findMany).mockResolvedValue([{ id: "item", code: "PARA", name: "Paracetamol" }] as never);
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: "maker", displayName: "Maker" }, { id: "checker", displayName: "Checker" }] as never);
    const response = await POST(request("PURCHASE_ORDER", "PRINT"));
    expect(response.status).toBe(200);
    expect((await response.json()).document).toMatchObject({ status: "CANCELLED", cancellationReason: "Supplier unable to deliver", total: "25.50", lines: [{ quantity: "10", receivedQuantity: "3" }], actors: [{ label: "Prepared by", name: "Maker" }, { label: "Cancelled by", name: "Checker" }] });
    expect(db.purchaseOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
    expect(db.catalogItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: actor.facilityId, id: { in: ["item"] } } }));
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: actor.facilityId, id: { in: ["maker", "checker"] } } }));
    expect(recordDisclosure).toHaveBeenCalledWith(actor, "OPERATIONS_READ:supply-document-print", [id], expect.objectContaining({ status: "CANCELLED" }));
  });
  it("bounds each facility-scoped document list and reports truncation", async () => {
    vi.mocked(db.purchaseOrder.findMany).mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ id: `order-${i}`, orderNumber: `PO-${i}`, status: "DRAFT", createdAt: new Date(snapshot.date), supplier: snapshot.supplier })) as never);
    vi.mocked(db.goodsReceipt.findMany).mockResolvedValue([{ id, receiptNumber: snapshot.reference, receivedAt: new Date(snapshot.date), snapshot }] as never);
    const response = await GET();
    const body = await response.json();
    expect(body.truncated).toBe(true);
    expect(body.documents).toHaveLength(101);
    expect(body.documents.filter((item: { kind: string }) => item.kind === "PURCHASE_ORDER")).toHaveLength(100);
    expect(db.goodsReceipt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: actor.facilityId }, take: 101 }));
    expect(recordDisclosure).toHaveBeenCalledWith(actor, "OPERATIONS_READ:supply-documents", expect.any(Array), body);
  });
  it.each(["PURCHASE_ORDER", "GOODS_RECEIPT"])("rejects anonymous %s printing before reads", async kind => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Unauthenticated"), { status: 401 }));
    expect((await POST(request(kind, "PRINT"))).status).toBe(401);
    expect(db.purchaseOrder.findFirst).not.toHaveBeenCalled(); expect(db.goodsReceipt.findFirst).not.toHaveBeenCalled();
  });
  it("rejects foreign orders before catalogue and staff lookups", async () => {
    vi.mocked(db.purchaseOrder.findFirst).mockResolvedValue(null);
    expect((await POST(request("PURCHASE_ORDER", "PRINT"))).status).toBe(404);
    expect(db.purchaseOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
    expect(db.catalogItem.findMany).not.toHaveBeenCalled(); expect(db.user.findMany).not.toHaveBeenCalled();
    expect(recordDisclosure).not.toHaveBeenCalled();
  });
  it.each([{ kind: "INVALID", id, intent: "PREVIEW" }, { kind: "GOODS_RECEIPT", id: "invalid", intent: "PRINT" }, { kind: "GOODS_RECEIPT", id, intent: "SEND" }])("rejects malformed document requests before reads: %j", async input => {
    expect((await POST(new Request("http://localhost/api/supply/documents", { method: "POST", body: JSON.stringify(input) }))).status).toBe(422);
    expect(db.goodsReceipt.findFirst).not.toHaveBeenCalled(); expect(db.purchaseOrder.findFirst).not.toHaveBeenCalled();
  });
  it("waits for preview disclosure auditing before returning contents", async () => {
    let release!: () => void;
    vi.mocked(recordDisclosure).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    let returned = false; const pending = POST(request()).then(response => { returned = true; return response; });
    await vi.waitFor(() => expect(recordDisclosure).toHaveBeenCalled()); expect(returned).toBe(false);
    release(); expect((await pending).status).toBe(200);
  });
  it("withholds the document index on audit failure", async () => {
    vi.mocked(db.purchaseOrder.findMany).mockResolvedValue([]); vi.mocked(db.goodsReceipt.findMany).mockResolvedValue([]);
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("Synthetic audit outage"));
    const response = await GET(); expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("documents");
  });
  it("audits only the disclosed receipts, never the extra truncation sentinel", async () => {
    vi.mocked(db.purchaseOrder.findMany).mockResolvedValue([]);
    vi.mocked(db.goodsReceipt.findMany).mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ id: `receipt-${i}`, receiptNumber: `GRN-${i}`, receivedAt: new Date(snapshot.date), snapshot })) as never);
    const response = await GET(); const body = await response.json();
    expect(body.documents).toHaveLength(100); expect(body.truncated).toBe(true);
    expect(recordDisclosure).toHaveBeenCalledWith(actor, "OPERATIONS_READ:supply-documents", Array.from({ length: 100 }, (_, i) => `receipt-${i}`), body);
    expect(db.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: actor.facilityId }, take: 101 }));
  });
  it("fails closed for malformed retained receipt evidence", async () => {
    vi.mocked(db.goodsReceipt.findFirst).mockResolvedValue({ snapshot: { ...snapshot, actors: "corrupt" } } as never);
    const response = await POST(request()); expect(response.status).toBe(422);
    expect(await response.json()).not.toHaveProperty("document"); expect(recordDisclosure).not.toHaveBeenCalled();
  });
});
