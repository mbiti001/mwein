import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { dispensingBalance } from "@/lib/pharmacy";

const inputSchema = z.object({
  action: z.enum(["DISPENSE", "NOT_DISPENSED"]),
  quantity: z.coerce.number().positive().optional(),
  notes: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (value.action === "DISPENSE" && value.quantity === undefined)
    context.addIssue({ code: "custom", path: ["quantity"], message: "Dispensed quantity is required" });
  if (value.action === "NOT_DISPENSED" && !value.notes)
    context.addIssue({ code: "custom", path: ["notes"], message: "Record why medicine was not dispensed" });
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("pharmacy.dispense");
    const { id } = await params;
    const input = inputSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const order = await tx.clinicalOrder.findFirst({
        where: { id, visit: { facilityId: user.facilityId }, type: "MEDICATION", status: { in: ["REQUESTED", "IN_PROGRESS"] } },
        include: { prescription: true, visit: { include: { orders: true } } },
      });
      if (!order?.prescription) throw Object.assign(new Error("Active prescription not found"), { status: 404 });
      const prescribed = Number(order.prescription.quantity);
      const quantity = input.action === "DISPENSE" ? input.quantity! : 0;
      const previouslyDispensed = Number(order.prescription.dispensedQuantity || 0);
      let balance: ReturnType<typeof dispensingBalance> | null = null;
      if (input.action === "DISPENSE") {
        try {
          balance = dispensingBalance(prescribed, previouslyDispensed, quantity);
        } catch (error) {
          throw Object.assign(error as Error, { status: 422 });
        }
      }
      if (input.action === "DISPENSE") {
        const item = await tx.catalogItem.findFirst({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", code: order.prescription.medicineCode.toUpperCase(), active: true } });
        if (!item) throw Object.assign(new Error("Medicine is not active in the formulary"), { status: 422 });
        const batches = await tx.inventoryBatch.findMany({ where: { catalogItemId: item.id, active: true, expiryDate: { gt: new Date() }, quantityAvailable: { gt: 0 } }, orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }] });
        const available = batches.reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0);
        if (available < quantity) throw Object.assign(new Error(`Insufficient unexpired stock. Available: ${available}`), { status: 409 });
        let needed = quantity;
        for (const batch of batches) {
          if (needed <= 0) break;
          const used = Math.min(needed, Number(batch.quantityAvailable));
          const balance = Number(batch.quantityAvailable) - used;
          await tx.inventoryBatch.update({ where: { id: batch.id }, data: { quantityAvailable: new Prisma.Decimal(balance), active: balance > 0 } });
          await tx.stockMovement.create({ data: { batchId: batch.id, userId: user.id, prescriptionId: order.prescription.id, type: "DISPENSE", quantity: new Prisma.Decimal(-used), balanceAfter: new Prisma.Decimal(balance), reason: `${order.visit.visitNumber} · ${order.displayName}` } });
          needed -= used;
        }
      }
      const dispenseStatus = input.action === "NOT_DISPENSED" ? "NOT_DISPENSED" : balance!.complete ? "DISPENSED" : "PARTIALLY_DISPENSED";
      await tx.prescription.update({ where: { id: order.prescription.id }, data: {
        dispensedQuantity: new Prisma.Decimal(balance?.cumulativeDispensed || previouslyDispensed), dispenseStatus, dispenseNotes: input.notes,
        dispensedAt: new Date(), dispensedById: user.id,
      }});
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
      await appendAudit(tx, { userId: user.id, action: `MEDICATION_${dispenseStatus}`, entityType: "ClinicalOrder", entityId: id, afterHash: `${quantity}:${balance?.cumulativeDispensed || previouslyDispensed}:${input.notes || ""}` });
      return { dispenseStatus, remainingQuantity: balance?.remainingAfter || 0, remainingOrders: remaining };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
