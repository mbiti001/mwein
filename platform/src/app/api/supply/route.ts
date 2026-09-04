import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SUPPLIER"), code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(160), phone: z.string().trim().max(30).optional(), email: z.email().optional() }),
  z.object({ action: z.literal("STORE"), code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(120) }),
  z.object({ action: z.literal("PURCHASE_ORDER"), supplierId: z.uuid(), catalogItemId: z.uuid(), quantity: z.coerce.number().positive(), unitCost: z.coerce.number().nonnegative().optional(), expectedAt: z.coerce.date().optional(), notes: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("RECEIVE"), lineId: z.uuid(), storeId: z.uuid(), batchNumber: z.string().trim().min(1).max(80), expiryDate: z.coerce.date(), quantity: z.coerce.number().positive() }),
  z.object({ action: z.literal("COUNT"), storeId: z.uuid(), batchId: z.uuid(), countedQuantity: z.coerce.number().nonnegative(), reason: z.string().trim().min(5).max(240) }),
  z.object({ action: z.literal("TRANSFER"), sourceStoreId: z.uuid(), destinationStoreId: z.uuid(), batchId: z.uuid(), quantity: z.coerce.number().positive(), reason: z.string().trim().min(5).max(240) }),
]);

export async function GET() {
  try {
    const user = await requirePermission("inventory.write");
    const [suppliers, stores, purchaseOrders, items, batches] = await Promise.all([
      db.supplier.findMany({ where: { facilityId: user.facilityId, active: true }, orderBy: { name: "asc" } }),
      db.store.findMany({ where: { facilityId: user.facilityId, active: true }, include: { balances: { include: { batch: { include: { catalogItem: { select: { name: true, code: true } } } } } } }, orderBy: { name: "asc" } }),
      db.purchaseOrder.findMany({ where: { facilityId: user.facilityId }, include: { supplier: true, lines: true }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.catalogItem.findMany({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
      db.inventoryBatch.findMany({ where: { catalogItem: { facilityId: user.facilityId }, active: true }, include: { catalogItem: { select: { name: true, code: true } }, locationBalances: { include: { store: true } } }, orderBy: { expiryDate: "asc" } }),
    ]);
    return NextResponse.json({ suppliers, stores, purchaseOrders, items, batches });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("inventory.write");
    const input = actionSchema.parse(await request.json());
    const result = await db.$transaction(async tx => {
      if (input.action === "SUPPLIER") { const record = await tx.supplier.create({ data: { facilityId: user.facilityId, code: input.code.toUpperCase(), name: input.name, phone: input.phone, email: input.email } }); await appendAudit(tx, { userId: user.id, action: "SUPPLIER_CREATED", entityType: "Supplier", entityId: record.id }); return record; }
      if (input.action === "STORE") { const record = await tx.store.create({ data: { facilityId: user.facilityId, code: input.code.toUpperCase(), name: input.name } }); await appendAudit(tx, { userId: user.id, action: "STORE_CREATED", entityType: "Store", entityId: record.id }); return record; }
      if (input.action === "PURCHASE_ORDER") {
        const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, facilityId: user.facilityId, active: true } });
        const item = await tx.catalogItem.findFirst({ where: { id: input.catalogItemId, facilityId: user.facilityId, active: true } });
        if (!supplier || !item) throw Object.assign(new Error("Active supplier or medicine was not found"), { status: 404 });
        const orderNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
        const record = await tx.purchaseOrder.create({ data: { facilityId: user.facilityId, supplierId: supplier.id, orderNumber, status: "APPROVED", expectedAt: input.expectedAt, notes: input.notes, createdById: user.id, lines: { create: { catalogItemId: item.id, quantityOrdered: new Prisma.Decimal(input.quantity), unitCost: input.unitCost == null ? undefined : new Prisma.Decimal(input.unitCost) } } }, include: { lines: true } }); await appendAudit(tx, { userId: user.id, action: "PURCHASE_ORDER_APPROVED", entityType: "PurchaseOrder", entityId: record.id }); return record;
      }
      if (input.action === "RECEIVE") {
        if (input.expiryDate <= new Date()) throw Object.assign(new Error("Expired stock cannot be received"), { status: 422 });
        const line = await tx.purchaseOrderLine.findFirst({ where: { id: input.lineId, purchaseOrder: { facilityId: user.facilityId } }, include: { purchaseOrder: true } });
        const store = await tx.store.findFirst({ where: { id: input.storeId, facilityId: user.facilityId, active: true } });
        if (!line || !store) throw Object.assign(new Error("Purchase-order line or receiving store was not found"), { status: 404 });
        const outstanding = Number(line.quantityOrdered) - Number(line.quantityReceived);
        if (input.quantity > outstanding) throw Object.assign(new Error(`Receipt exceeds the outstanding ordered quantity of ${outstanding}`), { status: 422 });
        const existing = await tx.inventoryBatch.findUnique({ where: { catalogItemId_batchNumber: { catalogItemId: line.catalogItemId, batchNumber: input.batchNumber } } });
        const batch = existing ? await tx.inventoryBatch.update({ where: { id: existing.id }, data: { quantityReceived: { increment: input.quantity }, quantityAvailable: { increment: input.quantity }, expiryDate: input.expiryDate, unitCost: line.unitCost } }) : await tx.inventoryBatch.create({ data: { catalogItemId: line.catalogItemId, batchNumber: input.batchNumber, expiryDate: input.expiryDate, quantityReceived: input.quantity, quantityAvailable: input.quantity, unitCost: line.unitCost } });
        await tx.inventoryLocationBalance.upsert({ where: { storeId_batchId: { storeId: store.id, batchId: batch.id } }, update: { quantity: { increment: input.quantity } }, create: { storeId: store.id, batchId: batch.id, quantity: input.quantity } });
        const updatedLine = await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { quantityReceived: { increment: input.quantity } } });
        if (Number(updatedLine.quantityReceived) >= Number(updatedLine.quantityOrdered)) await tx.purchaseOrder.update({ where: { id: line.purchaseOrderId }, data: { status: "RECEIVED", receivedAt: new Date() } });
        await tx.stockMovement.create({ data: { batchId: batch.id, userId: user.id, type: "RECEIPT", quantity: input.quantity, balanceAfter: batch.quantityAvailable, reason: `${line.purchaseOrder.orderNumber} · GRN to ${store.name}` } });
        await appendAudit(tx, { userId: user.id, action: "GOODS_RECEIVED", entityType: "PurchaseOrder", entityId: line.purchaseOrderId, afterHash: `${batch.id}:${input.quantity}:${store.id}` }); return batch;
      }
      if (input.action === "COUNT") {
        const balance = await tx.inventoryLocationBalance.findFirst({ where: { storeId: input.storeId, batchId: input.batchId, store: { facilityId: user.facilityId } }, include: { batch: true } });
        if (!balance) throw Object.assign(new Error("This batch is not held in the selected store"), { status: 404 });
        const variance = input.countedQuantity - Number(balance.quantity);
        await tx.inventoryLocationBalance.update({ where: { id: balance.id }, data: { quantity: input.countedQuantity } });
        const batch = await tx.inventoryBatch.update({ where: { id: balance.batchId }, data: { quantityAvailable: { increment: variance } } });
        await tx.inventoryControlEvent.create({ data: { facilityId: user.facilityId, type: "STOCK_COUNT", storeId: input.storeId, batchId: input.batchId, quantity: input.countedQuantity, variance, reason: input.reason, recordedById: user.id } });
        await tx.stockMovement.create({ data: { batchId: input.batchId, userId: user.id, type: "ADJUSTMENT", quantity: variance, balanceAfter: batch.quantityAvailable, reason: input.reason } });
        await appendAudit(tx, { userId: user.id, action: "STOCK_COUNT_POSTED", entityType: "InventoryBatch", entityId: batch.id, reason: input.reason, afterHash: `${input.countedQuantity}:${variance}` }); return batch;
      }
      if (input.sourceStoreId === input.destinationStoreId) throw Object.assign(new Error("Source and destination stores must be different"), { status: 422 });
      const source = await tx.inventoryLocationBalance.findFirst({ where: { storeId: input.sourceStoreId, batchId: input.batchId, store: { facilityId: user.facilityId } } });
      const destination = await tx.store.findFirst({ where: { id: input.destinationStoreId, facilityId: user.facilityId, active: true } });
      if (!source || !destination) throw Object.assign(new Error("Source stock or destination store was not found"), { status: 404 });
      if (Number(source.quantity) < input.quantity) throw Object.assign(new Error(`Only ${Number(source.quantity)} units are available in the source store`), { status: 422 });
      await tx.inventoryLocationBalance.update({ where: { id: source.id }, data: { quantity: { decrement: input.quantity } } });
      await tx.inventoryLocationBalance.upsert({ where: { storeId_batchId: { storeId: destination.id, batchId: input.batchId } }, update: { quantity: { increment: input.quantity } }, create: { storeId: destination.id, batchId: input.batchId, quantity: input.quantity } });
      const record = await tx.inventoryControlEvent.create({ data: { facilityId: user.facilityId, type: "TRANSFER", storeId: input.sourceStoreId, destinationStoreId: input.destinationStoreId, batchId: input.batchId, quantity: input.quantity, reason: input.reason, recordedById: user.id } }); await appendAudit(tx, { userId: user.id, action: "STOCK_TRANSFERRED", entityType: "InventoryControlEvent", entityId: record.id, reason: input.reason }); return record;
    });
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) { return apiError(error); }
}
