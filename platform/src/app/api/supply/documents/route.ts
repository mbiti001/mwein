import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { supplyDocumentSchema, type SupplyDocumentIndex } from "@/lib/supply-documents";

const requestSchema = z.object({ kind: z.enum(["PURCHASE_ORDER", "GOODS_RECEIPT"]), id: z.uuid(), intent: z.enum(["PREVIEW", "PRINT"]) });
function notFound(): never { throw Object.assign(new Error("Supply document was not found"), { status: 404 }); }

export async function GET() {
  try {
    const user = await requirePermission("inventory.view");
    const [orders, receipts] = await Promise.all([
      db.purchaseOrder.findMany({ where: { facilityId: user.facilityId }, select: { id: true, orderNumber: true, status: true, createdAt: true, supplier: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101 }),
      db.goodsReceipt.findMany({ where: { facilityId: user.facilityId }, select: { id: true, receiptNumber: true, receivedAt: true, snapshot: true }, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 101 }),
    ]);
    const documents: SupplyDocumentIndex[] = [
      ...orders.slice(0, 100).map(order => ({ id: order.id, kind: "PURCHASE_ORDER" as const, reference: order.orderNumber, date: order.createdAt.toISOString(), status: order.status, supplierName: order.supplier.name })),
      ...receipts.slice(0, 100).map(receipt => ({ id: receipt.id, kind: "GOODS_RECEIPT" as const, reference: receipt.receiptNumber, date: receipt.receivedAt.toISOString(), status: "POSTED", supplierName: supplyDocumentSchema.parse(receipt.snapshot).supplier.name })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    const body = { documents, truncated: orders.length > 100 || receipts.length > 100 };
    await recordDisclosure(user, "OPERATIONS_READ:supply-documents", documents.map(document => document.id), body);
    return privateJson(body);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("inventory.view");
    const input = requestSchema.parse(await request.json());
    let document;
    if (input.kind === "GOODS_RECEIPT") {
      const receipt = await db.goodsReceipt.findFirst({ where: { id: input.id, facilityId: user.facilityId }, select: { snapshot: true } });
      if (!receipt) notFound();
      document = supplyDocumentSchema.parse(receipt.snapshot);
    } else {
      const order = await db.purchaseOrder.findFirst({ where: { id: input.id, facilityId: user.facilityId }, include: { supplier: true, facility: { select: { name: true, code: true } }, lines: { orderBy: { id: "asc" } } } });
      if (!order) notFound();
      const [items, staff] = await Promise.all([
        db.catalogItem.findMany({ where: { facilityId: user.facilityId, id: { in: order.lines.map(line => line.catalogItemId) } }, select: { id: true, code: true, name: true } }),
        db.user.findMany({ where: { facilityId: user.facilityId, id: { in: [order.createdById, order.submittedById, order.approvedById, order.cancelledById].filter((id): id is string => Boolean(id)) } }, select: { id: true, displayName: true } }),
      ]);
      const lines = order.lines.map(line => {
        const item = items.find(item => item.id === line.catalogItemId);
        if (!item) throw new Error("Purchase-order catalogue evidence is missing");
        return { code: item.code, name: item.name, quantity: line.quantityOrdered.toString(), receivedQuantity: line.quantityReceived.toString(), unitCost: line.unitCost?.toFixed(2) ?? null, total: line.unitCost?.mul(line.quantityOrdered).toFixed(2) ?? null };
      });
      const actors = [
        { label: "Prepared by", id: order.createdById, at: order.createdAt },
        { label: "Submitted by", id: order.submittedById, at: order.submittedAt },
        { label: "Approved by", id: order.approvedById, at: order.approvedAt },
        { label: "Cancelled by", id: order.cancelledById, at: order.cancelledAt },
      ].filter(actor => actor.id && actor.at).map(actor => ({ label: actor.label, name: staff.find(person => person.id === actor.id)?.displayName || "Staff identity unavailable", at: actor.at!.toISOString() }));
      document = supplyDocumentSchema.parse({
        version: 1, kind: "PURCHASE_ORDER", reference: order.orderNumber, orderNumber: order.orderNumber,
        facilityName: order.facility.name, facilityCode: order.facility.code, status: order.status, date: order.createdAt.toISOString(),
        supplier: { name: order.supplier.name, code: order.supplier.code, phone: order.supplier.phone, email: order.supplier.email },
        expectedAt: order.expectedAt?.toISOString().slice(0, 10) ?? null, notes: order.notes, cancellationReason: order.cancellationReason, actors, lines,
        total: lines.every(line => line.total !== null) ? lines.reduce((sum, line) => sum.add(line.total!), new Prisma.Decimal(0)).toFixed(2) : null,
      });
    }
    // A PRINT event records a request, not proof that a printer produced paper.
    // Resolve again on every print so stale previews cannot mask a cancellation.
    await recordDisclosure(user, `OPERATIONS_READ:supply-document-${input.intent.toLowerCase()}`, [input.id], document);
    return privateJson({ document });
  } catch (error) { return apiError(error); }
}
