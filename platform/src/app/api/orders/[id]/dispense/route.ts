import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { dispensingBalance, planFefoAllocation } from "@/lib/pharmacy";

const inputSchema = z.object({
  action: z.enum(["DISPENSE", "NOT_DISPENSED"]),
  idempotencyKey: z.uuid(),
  quantity: z.coerce.number().positive().optional(),
  counsellingCompleted: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (value.action === "DISPENSE" && value.quantity === undefined)
    context.addIssue({ code: "custom", path: ["quantity"], message: "Dispensed quantity is required" });
  if (value.action === "NOT_DISPENSED" && !value.notes)
    context.addIssue({ code: "custom", path: ["notes"], message: "Record why medicine was not dispensed" });
  if (value.action === "DISPENSE" && value.counsellingCompleted !== true)
    context.addIssue({ code: "custom", path: ["counsellingCompleted"], message: "Confirm that medicine counselling was completed" });
});

async function findDispensableOrder(id: string, facilityId: string) {
  const order = await db.clinicalOrder.findFirst({
    where: { id, visit: { facilityId }, type: "MEDICATION", status: { in: ["REQUESTED", "IN_PROGRESS"] } },
    include: { prescription: true },
  });
  if (!order?.prescription) throw Object.assign(new Error("Active prescription not found"), { status: 404 });
  return order;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("pharmacy.dispense");
    const { id } = await params;
    const order = await findDispensableOrder(id, user.facilityId);
    const item = await db.catalogItem.findFirst({
      where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", code: order.prescription!.medicineCode.toUpperCase(), active: true },
      include: { inventoryBatches: { where: { active: true, expiryDate: { gt: new Date() }, quantityAvailable: { gt: 0 } }, orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }] } },
    });
    const outstanding = Math.max(0, Number(order.prescription!.quantity) - Number(order.prescription!.dispensedQuantity || 0));
    const requested = z.coerce.number().positive().max(outstanding).optional().parse(new URL(request.url).searchParams.get("quantity") || undefined);
    const batches = item?.inventoryBatches.map(batch => ({
      id: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantityAvailable: Number(batch.quantityAvailable),
      daysToExpiry: Math.ceil((batch.expiryDate.getTime() - Date.now()) / 86400000),
    })) || [];
    const plannedQuantity = Math.min(requested || outstanding, batches.reduce((sum, batch) => sum + batch.quantityAvailable, 0));
    const allocation = plannedQuantity > 0 ? planFefoAllocation(batches, plannedQuantity) : [];
    return NextResponse.json({ outstanding, available: batches.reduce((sum, batch) => sum + batch.quantityAvailable, 0), allocation });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("pharmacy.dispense");
    const { id } = await params;
    const input = inputSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const replay = await tx.dispensation.findFirst({ where: { idempotencyKey: input.idempotencyKey, prescription: { orderId: id } }, include: { prescription: true, items: { include: { batch: true } } } });
      if (replay) return { dispenseStatus: replay.status, remainingQuantity: Math.max(0, Number(replay.prescription.quantity) - Number(replay.prescription.dispensedQuantity || 0)), remainingOrders: -1, replayed: true, allocations: replay.items.map(value => ({ id: value.batchId, batchNumber: value.batch.batchNumber, expiryDate: value.batch.expiryDate, quantity: Number(value.quantity), quantityAvailable: Number(value.batch.quantityAvailable) })) };
      const order = await tx.clinicalOrder.findFirst({
        where: { id, visit: { facilityId: user.facilityId }, type: "MEDICATION", status: { in: ["REQUESTED", "IN_PROGRESS"] } },
        include: { prescription: true, visit: { include: { orders: true, invoice: true } } },
      });
      if (!order?.prescription) throw Object.assign(new Error("Active prescription not found"), { status: 404 });
      const prescribed = Number(order.prescription.quantity);
      const quantity = input.action === "DISPENSE" ? input.quantity! : 0;
      const previouslyDispensed = Number(order.prescription.dispensedQuantity || 0);
      let balance: ReturnType<typeof dispensingBalance> | null = null;
      let allocations: ReturnType<typeof planFefoAllocation> = [];
      let catalogItem: Awaited<ReturnType<typeof tx.catalogItem.findFirst>> = null;
      if (input.action === "DISPENSE") {
        try {
          balance = dispensingBalance(prescribed, previouslyDispensed, quantity);
        } catch (error) {
          throw Object.assign(error as Error, { status: 422 });
        }
      }
      if (input.action === "DISPENSE") {
        catalogItem = await tx.catalogItem.findFirst({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", code: order.prescription.medicineCode.toUpperCase(), active: true } });
        if (!catalogItem) throw Object.assign(new Error("Medicine is not active in the formulary"), { status: 422 });
        const batches = await tx.inventoryBatch.findMany({ where: { catalogItemId: catalogItem.id, active: true, expiryDate: { gt: new Date() }, quantityAvailable: { gt: 0 } }, orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }] });
        try {
          allocations = planFefoAllocation(batches.map(batch => ({ ...batch, quantityAvailable: Number(batch.quantityAvailable) })), quantity);
        } catch (error) {
          throw Object.assign(error as Error, { status: 409 });
        }
        const dispensation = await tx.dispensation.create({ data: { prescriptionId: order.prescription.id, dispensedById: user.id, idempotencyKey: input.idempotencyKey, status: balance!.complete ? "DISPENSED" : "PARTIALLY_DISPENSED", quantity: new Prisma.Decimal(quantity), counsellingCompleted: true, notes: input.notes } });
        for (const allocation of allocations) {
          const batch = batches.find(candidate => candidate.id === allocation.id)!;
          const batchBalance = Number(batch.quantityAvailable) - allocation.quantity;
          await tx.inventoryBatch.update({ where: { id: batch.id }, data: { quantityAvailable: new Prisma.Decimal(batchBalance), active: batchBalance > 0 } });
          await tx.dispensationItem.create({ data: { dispensationId: dispensation.id, batchId: batch.id, quantity: new Prisma.Decimal(allocation.quantity), unitPrice: catalogItem.unitPrice, unitCost: batch.unitCost } });
          await tx.stockMovement.create({ data: { batchId: batch.id, userId: user.id, prescriptionId: order.prescription.id, dispensationId: dispensation.id, type: "DISPENSE", quantity: new Prisma.Decimal(-allocation.quantity), balanceAfter: new Prisma.Decimal(batchBalance), reason: `${order.visit.visitNumber} · ${order.displayName}` } });
        }
      } else {
        await tx.dispensation.create({ data: { prescriptionId: order.prescription.id, dispensedById: user.id, idempotencyKey: input.idempotencyKey, status: "NOT_DISPENSED", quantity: new Prisma.Decimal(0), notes: input.notes } });
      }
      const dispenseStatus = input.action === "NOT_DISPENSED" ? "NOT_DISPENSED" : balance!.complete ? "DISPENSED" : "PARTIALLY_DISPENSED";
      await tx.prescription.update({ where: { id: order.prescription.id }, data: {
        dispensedQuantity: new Prisma.Decimal(balance?.cumulativeDispensed || previouslyDispensed), dispenseStatus, dispenseNotes: input.notes,
        counsellingCompleted: input.action === "DISPENSE" ? true : undefined, counselledAt: input.action === "DISPENSE" ? new Date() : undefined,
        dispensedAt: new Date(), dispensedById: user.id,
      }});
      if (input.action === "DISPENSE") {
        await tx.invoiceItem.upsert({
          where: { orderId: order.id },
          update: { quantity: new Prisma.Decimal(balance!.cumulativeDispensed), unitPrice: catalogItem!.unitPrice, description: catalogItem!.name },
          create: { invoiceId: order.visit.invoice!.id, orderId: order.id, serviceCode: `MED-${order.prescription.medicineCode}`, description: catalogItem!.name, quantity: new Prisma.Decimal(balance!.cumulativeDispensed), unitPrice: catalogItem!.unitPrice },
        });
      } else if (previouslyDispensed === 0) {
        await tx.invoiceItem.deleteMany({ where: { orderId: order.id } });
      }
      const orderComplete = input.action === "NOT_DISPENSED" || balance!.complete;
      await tx.clinicalOrder.update({ where: { id }, data: {
        status: orderComplete ? "COMPLETED" : "IN_PROGRESS",
        completedAt: orderComplete ? new Date() : null,
      }});
      const remaining = await tx.clinicalOrder.count({ where: { visitId: order.visitId, type: "MEDICATION", status: { in: ["REQUESTED", "IN_PROGRESS"] } } });
      if (!remaining) {
        await tx.queueEntry.updateMany({ where: { visitId: order.visitId, servicePoint: "PHARMACY", status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
        await tx.queueEntry.create({ data: { visitId: order.visitId, servicePoint: "BILLING", priority: order.visit.priority } });
        await tx.visit.update({ where: { id: order.visitId }, data: { status: "AWAITING_PAYMENT" } });
      }
      const batchTrace = allocations.map(item => `${item.batchNumber}:${item.quantity}`).join("|");
      await appendAudit(tx, { userId: user.id, action: `MEDICATION_${dispenseStatus}`, entityType: "ClinicalOrder", entityId: id, afterHash: `${quantity}:${balance?.cumulativeDispensed || previouslyDispensed}:${input.counsellingCompleted === true}:${batchTrace}:${input.notes || ""}` });
      return { dispenseStatus, remainingQuantity: balance?.remainingAfter || 0, remainingOrders: remaining, allocations };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
