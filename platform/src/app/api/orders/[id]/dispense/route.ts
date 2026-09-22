import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import {
  dispensingBalance,
  isEquivalentMedication,
  planDispensingAllocation,
} from "@/lib/pharmacy";
import { assertStoresNotFrozen, postInventoryJournal } from "@/lib/inventory-accounting";
import { effectiveCatalogPrice } from "@/lib/catalog-pricing";

const reason = z.string().trim().min(5).max(500).optional();
const inputSchema = z.object({
  action: z.enum(["DISPENSE", "NOT_DISPENSED"]),
  idempotencyKey: z.uuid(),
  quantity: z.coerce.number().positive().optional(),
  counsellingCompleted: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
  catalogItemId: z.uuid().optional(),
  preferredBatchId: z.uuid().optional(),
  substitutionReason: reason,
  fefoOverrideReason: reason,
}).superRefine((value, context) => {
  if (value.action === "DISPENSE" && value.quantity === undefined)
    context.addIssue({ code: "custom", path: ["quantity"], message: "Dispensed quantity is required" });
  if (value.action === "NOT_DISPENSED" && !value.notes)
    context.addIssue({ code: "custom", path: ["notes"], message: "Record why medicine was not dispensed" });
  if (value.action === "DISPENSE" && value.counsellingCompleted !== true)
    context.addIssue({ code: "custom", path: ["counsellingCompleted"], message: "Confirm that medicine counselling was completed" });
});

function fail(message: string, status = 422): never {
  throw Object.assign(new Error(message), { status });
}

async function findDispensableOrder(id: string, facilityId: string) {
  const order = await db.clinicalOrder.findFirst({
    where: { id, visit: { facilityId }, type: "MEDICATION", status: { in: ["REQUESTED", "IN_PROGRESS"] } },
    include: { prescription: true },
  });
  if (!order || !order.prescription) fail("Active prescription not found", 404);
  return { ...order, prescription: order.prescription };
}

function prescriptionIdentity(prescription: {
  medicationConceptId?: string | null;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
}, prescribedItem: {
  medicationConceptId?: string | null;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
}) {
  return {
    medicationConceptId: prescription.medicationConceptId || prescribedItem.medicationConceptId,
    genericName: prescription.genericName || prescribedItem.genericName,
    strength: prescription.strength || prescribedItem.strength,
    dosageForm: prescription.dosageForm || prescribedItem.dosageForm,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("pharmacy.dispense");
    const { id } = await params;
    const order = await findDispensableOrder(id, user.facilityId);
    const [prescribedItem, mainStore] = await Promise.all([
      db.catalogItem.findFirst({
        where: {
          facilityId: user.facilityId,
          category: "PHARMACEUTICAL",
          active: true,
          ...(order.prescription.catalogItemId
            ? { id: order.prescription.catalogItemId }
            : { code: order.prescription.medicineCode.toUpperCase() }),
        },
      }),
      db.store.findFirst({ where: { facilityId: user.facilityId, code: "MAIN", active: true } }),
    ]);
    if (!prescribedItem) fail("Prescribed medicine is not active in the formulary");
    if (!mainStore) fail("Main pharmacy store is not configured", 409);

    const url = new URL(request.url);
    const selectedId = z.uuid().optional().parse(url.searchParams.get("catalogItemId") || undefined);
    const preferredBatchId = z.uuid().optional().parse(url.searchParams.get("preferredBatchId") || undefined);
    const outstanding = Math.max(0, Number(order.prescription.quantity) - Number(order.prescription.dispensedQuantity || 0));
    const requested = z.coerce.number().positive().max(outstanding).optional().parse(url.searchParams.get("quantity") || undefined);
    const identity = prescriptionIdentity(order.prescription, prescribedItem);
    const candidates = (await db.catalogItem.findMany({
      where: {
        facilityId: user.facilityId,
        category: "PHARMACEUTICAL",
        active: true,
        OR: [
          { id: prescribedItem.id },
          ...(identity.medicationConceptId ? [{ medicationConceptId: identity.medicationConceptId }] : []),
          ...(identity.genericName ? [{ genericName: { equals: identity.genericName, mode: "insensitive" as const } }] : []),
        ],
      },
      include: {
        inventoryBatches: {
          where: {
            active: true,
            expiryDate: { gt: new Date() },
            quantityAvailable: { gt: 0 },
            locationBalances: { some: { storeId: mainStore.id, quantity: { gt: 0 } } },
          },
          include: { locationBalances: { where: { storeId: mainStore.id } } },
          orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    })).filter((item) => item.id === prescribedItem.id || isEquivalentMedication(identity, item));
    const selectedItem = selectedId
      ? candidates.find((item) => item.id === selectedId)
      : candidates.find((item) => item.id === prescribedItem.id);
    if (!selectedItem) fail("Selected medicine is not an equivalent active formulary item");

    const batches = selectedItem.inventoryBatches.map((batch) => ({
      id: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantityAvailable: Number(batch.locationBalances[0]?.quantity || 0),
      daysToExpiry: Math.ceil((batch.expiryDate.getTime() - Date.now()) / 86400000),
    }));
    const available = batches.reduce((sum, batch) => sum + batch.quantityAvailable, 0);
    const plannedQuantity = Math.min(requested || outstanding, available);
    const plan = plannedQuantity > 0
      ? planDispensingAllocation(batches, plannedQuantity, preferredBatchId)
      : { allocation: [], standardAllocation: [], fefoOverridden: false };
    return NextResponse.json({
      outstanding,
      available,
      allocation: plan.allocation,
      standardAllocation: plan.standardAllocation,
      fefoOverridden: plan.fefoOverridden,
      substitutionRequired: selectedItem.id !== prescribedItem.id,
      prescribedCatalogItem: { id: prescribedItem.id, code: prescribedItem.code, name: prescribedItem.name },
      selectedCatalogItem: { id: selectedItem.id, code: selectedItem.code, name: selectedItem.name },
      medicines: candidates.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        available: item.inventoryBatches.reduce((sum, batch) => sum + Number(batch.locationBalances[0]?.quantity || 0), 0),
      })),
      batches,
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("pharmacy.dispense");
    const { id } = await params;
    const input = inputSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const replay = await tx.dispensation.findFirst({
        where: { idempotencyKey: input.idempotencyKey, prescription: { orderId: id } },
        include: { prescription: true, catalogItem: true, items: { include: { batch: true } } },
      });
      if (replay) return {
        dispenseStatus: replay.status,
        remainingQuantity: Math.max(0, Number(replay.prescription.quantity) - Number(replay.prescription.dispensedQuantity || 0)),
        remainingOrders: -1,
        replayed: true,
        dispensedMedicine: replay.catalogItem ? { id: replay.catalogItem.id, code: replay.catalogItem.code, name: replay.catalogItem.name } : null,
        allocations: replay.items.map((value) => ({ id: value.batchId, batchNumber: value.batch.batchNumber, expiryDate: value.batch.expiryDate, quantity: Number(value.quantity), quantityAvailable: Number(value.batch.quantityAvailable) })),
      };
      const order = await tx.clinicalOrder.findFirst({
        where: { id, visit: { facilityId: user.facilityId }, type: "MEDICATION", status: { in: ["REQUESTED", "IN_PROGRESS"] } },
        include: { prescription: true, visit: { include: { orders: true, invoice: true } } },
      });
      if (!order?.prescription) fail("Active prescription not found", 404);
      if (order.visit.clinicallyClosedAt || ["DISCHARGED", "COMPLETED", "CANCELLED"].includes(order.visit.status)) fail("Clinical visit is closed", 409);
      const prescribed = Number(order.prescription.quantity);
      const quantity = input.action === "DISPENSE" ? input.quantity! : 0;
      const previouslyDispensed = Number(order.prescription.dispensedQuantity || 0);
      let balance: ReturnType<typeof dispensingBalance> | null = null;
      let allocations: ReturnType<typeof planDispensingAllocation>["allocation"] = [];
      let standardAllocations: ReturnType<typeof planDispensingAllocation>["standardAllocation"] = [];
      let prescribedItem: Awaited<ReturnType<typeof tx.catalogItem.findFirst>> = null;
      let dispensedItem: Awaited<ReturnType<typeof tx.catalogItem.findFirst>> = null;
      let fefoOverridden = false;
      let substituted = false;
      if (input.action === "DISPENSE") {
        try { balance = dispensingBalance(prescribed, previouslyDispensed, quantity); }
        catch (error) { throw Object.assign(error as Error, { status: 422 }); }

        prescribedItem = await tx.catalogItem.findFirst({
          where: {
            facilityId: user.facilityId,
            category: "PHARMACEUTICAL",
            ...(order.prescription.catalogItemId
              ? { id: order.prescription.catalogItemId }
              : { code: order.prescription.medicineCode.toUpperCase() }),
          },
          include: { priceVersions: { where: { effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
        });
        if (!prescribedItem) fail("Prescribed medicine is not in the formulary");
        dispensedItem = await tx.catalogItem.findFirst({
          where: {
            id: input.catalogItemId || prescribedItem.id,
            facilityId: user.facilityId,
            category: "PHARMACEUTICAL",
            active: true,
          },
          include: { priceVersions: { where: { effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
        });
        if (!dispensedItem) fail("Selected medicine is not active in the formulary");
        substituted = dispensedItem.id !== prescribedItem.id;
        if (substituted && !isEquivalentMedication(prescriptionIdentity(order.prescription, prescribedItem), dispensedItem))
          fail("Substitution must keep the prescribed ingredient, strength and dosage form");
        if (substituted && !input.substitutionReason)
          fail("Record a reason for substituting the prescribed medicine");

        const mainStore = await tx.store.findFirst({ where: { facilityId: user.facilityId, code: "MAIN", active: true } });
        if (!mainStore) fail("Main pharmacy store is not configured", 409);
        await assertStoresNotFrozen(tx, user.facilityId, [mainStore.id]);
        const batches = await tx.inventoryBatch.findMany({
          where: {
            catalogItemId: dispensedItem.id,
            active: true,
            expiryDate: { gt: new Date() },
            quantityAvailable: { gt: 0 },
            locationBalances: { some: { storeId: mainStore.id, quantity: { gt: 0 } } },
          },
          include: { locationBalances: { where: { storeId: mainStore.id } } },
          orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
        });
        try {
          const plan = planDispensingAllocation(
            batches.map((batch) => ({ ...batch, quantityAvailable: Number(batch.locationBalances[0]?.quantity || 0) })),
            quantity,
            input.preferredBatchId,
          );
          allocations = plan.allocation;
          standardAllocations = plan.standardAllocation;
          fefoOverridden = plan.fefoOverridden;
        } catch (error) { throw Object.assign(error as Error, { status: 409 }); }
        if (fefoOverridden && !input.fefoOverrideReason)
          fail("Record a reason for overriding the FEFO batch plan");

        const dispensation = await tx.dispensation.create({ data: {
          prescriptionId: order.prescription.id,
          dispensedById: user.id,
          catalogItemId: dispensedItem.id,
          idempotencyKey: input.idempotencyKey,
          status: balance.complete ? "DISPENSED" : "PARTIALLY_DISPENSED",
          quantity: new Prisma.Decimal(quantity),
          counsellingCompleted: true,
          notes: input.notes,
          substitutionReason: substituted ? input.substitutionReason : undefined,
          fefoOverrideReason: fefoOverridden ? input.fefoOverrideReason : undefined,
        } });
        for (const allocation of allocations) {
          const batch = batches.find((candidate) => candidate.id === allocation.id)!;
          const batchBalance = Number(batch.quantityAvailable) - allocation.quantity;
          await tx.inventoryBatch.update({ where: { id: batch.id }, data: { quantityAvailable: new Prisma.Decimal(batchBalance), active: batchBalance > 0 } });
          const storeBalance = await tx.inventoryLocationBalance.update({ where: { storeId_batchId: { storeId: mainStore.id, batchId: batch.id } }, data: { quantity: { decrement: allocation.quantity } } });
          await tx.dispensationItem.create({ data: { dispensationId: dispensation.id, batchId: batch.id, quantity: new Prisma.Decimal(allocation.quantity), unitPrice: new Prisma.Decimal(Number(effectiveCatalogPrice(dispensedItem).unitPrice)), unitCost: batch.unitCost } });
          const movement = await tx.stockMovement.create({ data: {
            batchId: batch.id,
            userId: user.id,
            prescriptionId: order.prescription.id,
            dispensationId: dispensation.id,
            sourceStoreId: mainStore.id,
            type: "DISPENSE",
            quantity: new Prisma.Decimal(-allocation.quantity),
            balanceAfter: new Prisma.Decimal(batchBalance),
            sourceBalanceAfter: storeBalance.quantity,
            reason: `${order.visit.visitNumber} · prescribed ${prescribedItem.code} · supplied ${dispensedItem.code}`,
          } });
          await postInventoryJournal(tx, { facilityId: user.facilityId, postedById: user.id, sourceType: "STOCK_MOVEMENT", sourceId: movement.id, description: `${order.visit.visitNumber} · ${dispensedItem.name}`, movementType: "DISPENSE", signedQuantity: -allocation.quantity, unitCost: batch.unitCost == null ? null : Number(batch.unitCost), catalogItemId: dispensedItem.id, batchId: batch.id, storeId: mainStore.id, occurredAt: movement.occurredAt });
        }
        if (substituted) await appendAudit(tx, {
          userId: user.id,
          action: "MEDICATION_SUBSTITUTED",
          entityType: "Dispensation",
          entityId: dispensation.id,
          reason: input.substitutionReason,
          beforeHash: prescribedItem.code,
          afterHash: dispensedItem.code,
        });
        if (fefoOverridden) await appendAudit(tx, {
          userId: user.id,
          action: "FEFO_BATCH_OVERRIDDEN",
          entityType: "Dispensation",
          entityId: dispensation.id,
          reason: input.fefoOverrideReason,
          beforeHash: standardAllocations.map((item) => `${item.batchNumber}:${item.quantity}`).join("|"),
          afterHash: allocations.map((item) => `${item.batchNumber}:${item.quantity}`).join("|"),
        });
      } else {
        await tx.dispensation.create({ data: { prescriptionId: order.prescription.id, dispensedById: user.id, idempotencyKey: input.idempotencyKey, status: "NOT_DISPENSED", quantity: new Prisma.Decimal(0), notes: input.notes } });
      }
      const dispenseStatus = input.action === "NOT_DISPENSED" ? "NOT_DISPENSED" : balance!.complete ? "DISPENSED" : "PARTIALLY_DISPENSED";
      await tx.prescription.update({ where: { id: order.prescription.id }, data: {
        dispensedQuantity: new Prisma.Decimal(balance?.cumulativeDispensed || previouslyDispensed),
        dispenseStatus,
        dispenseNotes: input.notes,
        counsellingCompleted: input.action === "DISPENSE" ? true : undefined,
        counselledAt: input.action === "DISPENSE" ? new Date() : undefined,
        dispensedAt: new Date(),
        dispensedById: user.id,
      } });
      if (input.action === "DISPENSE") {
        const price = effectiveCatalogPrice(dispensedItem!);
        await tx.invoiceItem.upsert({
          where: { orderId: order.id },
          update: { quantity: new Prisma.Decimal(balance!.cumulativeDispensed), unitPrice: new Prisma.Decimal(Number(price.unitPrice)), catalogItemId: dispensedItem!.id, priceVersionId: price.priceVersionId, serviceCode: `MED-${dispensedItem!.code}`, description: dispensedItem!.name },
          create: {
            invoiceId: order.visit.invoice!.id,
            orderId: order.id,
            serviceCode: `MED-${dispensedItem!.code}`,
            description: dispensedItem!.name,
            quantity: new Prisma.Decimal(balance!.cumulativeDispensed),
            unitPrice: new Prisma.Decimal(Number(price.unitPrice)),
            catalogItemId: dispensedItem!.id,
            priceVersionId: price.priceVersionId,
          },
        });
      } else if (previouslyDispensed === 0) {
        await tx.invoiceItem.deleteMany({ where: { orderId: order.id } });
      }
      const orderComplete = input.action === "NOT_DISPENSED" || balance!.complete;
      await tx.clinicalOrder.update({ where: { id }, data: { status: orderComplete ? "COMPLETED" : "IN_PROGRESS", completedAt: orderComplete ? new Date() : null } });
      const remaining = await tx.clinicalOrder.count({ where: { visitId: order.visitId, type: "MEDICATION", status: { in: ["REQUESTED", "IN_PROGRESS"] } } });
      if (!remaining) {
        await tx.queueEntry.updateMany({ where: { visitId: order.visitId, servicePoint: "PHARMACY", status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
        await tx.queueEntry.create({ data: { visitId: order.visitId, servicePoint: "BILLING", priority: order.visit.priority } });
        await tx.visit.update({ where: { id: order.visitId }, data: { status: "AWAITING_PAYMENT" } });
      }
      const batchTrace = allocations.map((item) => `${item.batchNumber}:${item.quantity}`).join("|");
      await appendAudit(tx, {
        userId: user.id,
        action: `MEDICATION_${dispenseStatus}`,
        entityType: "ClinicalOrder",
        entityId: id,
        afterHash: `${quantity}:${balance?.cumulativeDispensed || previouslyDispensed}:${input.counsellingCompleted === true}:${batchTrace}:${dispensedItem?.code || ""}:${input.substitutionReason || ""}:${input.fefoOverrideReason || ""}:${input.notes || ""}`,
      });
      return {
        dispenseStatus,
        remainingQuantity: balance?.remainingAfter || 0,
        remainingOrders: remaining,
        allocations,
        substituted,
        fefoOverridden,
        dispensedMedicine: dispensedItem ? { id: dispensedItem.id, code: dispensedItem.code, name: dispensedItem.name } : null,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
