import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { canTransitionPurchaseOrder, countDisposition, isIndependentChecker } from "@/lib/supply-controls";
import {
  assertStoresNotFrozen,
  postInventoryJournal,
  stocktakeVariance,
  weightedAverageUnitCost,
} from "@/lib/inventory-accounting";

const key = z.string().uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SUPPLIER"), code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(160), phone: z.string().trim().max(30).optional(), email: z.email().optional() }),
  z.object({ action: z.literal("STORE"), code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(120) }),
  z.object({ action: z.literal("PURCHASE_ORDER"), idempotencyKey: key, supplierId: z.uuid(), catalogItemId: z.uuid(), quantity: z.coerce.number().positive(), unitCost: z.coerce.number().positive().optional(), expectedAt: z.coerce.date().optional(), notes: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("SUBMIT_PURCHASE_ORDER"), purchaseOrderId: z.uuid() }),
  z.object({ action: z.literal("APPROVE_PURCHASE_ORDER"), purchaseOrderId: z.uuid() }),
  z.object({ action: z.literal("CANCEL_PURCHASE_ORDER"), purchaseOrderId: z.uuid(), reason: z.string().trim().min(5).max(240) }),
  z.object({ action: z.literal("RECEIVE"), idempotencyKey: key, lineId: z.uuid(), storeId: z.uuid(), batchNumber: z.string().trim().min(1).max(80), expiryDate: z.coerce.date(), quantity: z.coerce.number().positive() }),
  z.object({ action: z.literal("CORRECT_BATCH_EXPIRY"), idempotencyKey: key, batchId: z.uuid(), expiryDate: z.coerce.date(), reason: z.string().trim().min(5).max(240) }),
  z.object({ action: z.literal("COUNT"), idempotencyKey: key, storeId: z.uuid(), batchId: z.uuid(), countedQuantity: z.coerce.number().nonnegative(), reason: z.string().trim().min(5).max(240) }),
  z.object({ action: z.literal("APPROVE_COUNT"), eventId: z.uuid() }),
  z.object({ action: z.literal("EMERGENCY_ADJUST"), idempotencyKey: key, storeId: z.uuid(), batchId: z.uuid(), newQuantity: z.coerce.number().nonnegative(), reason: z.string().trim().min(10).max(240) }),
  z.object({ action: z.literal("TRANSFER"), idempotencyKey: key, sourceStoreId: z.uuid(), destinationStoreId: z.uuid(), batchId: z.uuid(), quantity: z.coerce.number().positive(), reason: z.string().trim().min(5).max(240) }),
  z.object({ action: z.literal("START_STOCKTAKE"), idempotencyKey: key, storeId: z.uuid(), notes: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("SUBMIT_STOCKTAKE"), idempotencyKey: key, stocktakeId: z.uuid(), lines: z.array(z.object({ lineId: z.uuid(), countedQuantity: z.coerce.number().nonnegative(), reason: z.string().trim().max(240).optional() })).min(1).max(5000) }),
  z.object({ action: z.literal("APPROVE_STOCKTAKE"), idempotencyKey: key, stocktakeId: z.uuid() }),
  z.object({ action: z.literal("CANCEL_STOCKTAKE"), stocktakeId: z.uuid(), reason: z.string().trim().min(5).max(240) }),
]);
const permissions: Record<string, string> = { SUPPLIER: "procurement.manage_suppliers", STORE: "inventory.manage_stores", PURCHASE_ORDER: "procurement.create", SUBMIT_PURCHASE_ORDER: "procurement.create", APPROVE_PURCHASE_ORDER: "procurement.approve", CANCEL_PURCHASE_ORDER: "procurement.approve", RECEIVE: "inventory.receive", CORRECT_BATCH_EXPIRY: "inventory.correct_metadata", COUNT: "inventory.count", APPROVE_COUNT: "inventory.adjust", EMERGENCY_ADJUST: "inventory.adjust", TRANSFER: "inventory.transfer", START_STOCKTAKE: "inventory.count", SUBMIT_STOCKTAKE: "inventory.count", APPROVE_STOCKTAKE: "inventory.reconcile", CANCEL_STOCKTAKE: "inventory.reconcile" };
function fail(message: string, status = 422): never { throw Object.assign(new Error(message), { status }); }

export async function GET() {
  try {
    const user = await requirePermission("inventory.view");
    const [suppliers, stores, purchaseOrders, items, batches, pendingCounts, emergencyAdjustments, movements, stocktakes, journals, soldItems] = await Promise.all([
      db.supplier.findMany({ where: { facilityId: user.facilityId, active: true }, orderBy: { name: "asc" } }),
      db.store.findMany({ where: { facilityId: user.facilityId, active: true }, include: { balances: { include: { batch: { include: { catalogItem: { select: { name: true, code: true } } } } } } }, orderBy: { name: "asc" } }),
      db.purchaseOrder.findMany({ where: { facilityId: user.facilityId }, include: { supplier: true, lines: true }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.catalogItem.findMany({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
      db.inventoryBatch.findMany({ where: { catalogItem: { facilityId: user.facilityId }, active: true }, include: { catalogItem: { select: { name: true, code: true } }, locationBalances: { include: { store: true } } }, orderBy: { expiryDate: "asc" } }),
      db.inventoryControlEvent.findMany({ where: { facilityId: user.facilityId, type: "STOCK_COUNT", status: "PENDING" }, orderBy: { occurredAt: "asc" } }),
      db.inventoryControlEvent.findMany({ where: { facilityId: user.facilityId, type: "EMERGENCY_ADJUSTMENT", status: "RECONCILIATION_REQUIRED" }, orderBy: { occurredAt: "asc" } }),
      db.stockMovement.findMany({
        where: { batch: { catalogItem: { facilityId: user.facilityId } } },
        include: {
          batch: { include: { catalogItem: { select: { code: true, name: true } } } },
          user: { select: { displayName: true } },
          sourceStore: { select: { code: true, name: true } },
          destinationStore: { select: { code: true, name: true } },
        },
        orderBy: { occurredAt: "desc" },
        take: 150,
      }),
      db.stocktake.findMany({
        where: { facilityId: user.facilityId },
        include: {
          store: { select: { code: true, name: true } },
          openedBy: { select: { displayName: true } },
          submittedBy: { select: { displayName: true } },
          approvedBy: { select: { displayName: true } },
          lines: {
            include: {
              batch: { include: { catalogItem: { select: { code: true, name: true } } } },
              countedBy: { select: { displayName: true } },
            },
            orderBy: [{ batch: { catalogItem: { name: "asc" } } }, { batch: { expiryDate: "asc" } }],
          },
        },
        orderBy: { openedAt: "desc" },
        take: 20,
      }),
      user.permissions.includes("accounting.view")
        ? db.accountingJournal.findMany({ where: { facilityId: user.facilityId }, include: { lines: true, postedBy: { select: { displayName: true } } }, orderBy: { occurredAt: "desc" }, take: 100 })
        : Promise.resolve([]),
      user.permissions.includes("accounting.view")
        ? db.dispensationItem.findMany({
          where: { dispensation: { dispensedAt: { gte: new Date(Date.now() - 30 * 86400000) }, prescription: { order: { visit: { facilityId: user.facilityId } } } } },
          select: { quantity: true, unitPrice: true, unitCost: true, batch: { select: { catalogItem: { select: { id: true, code: true, name: true } } } } },
        })
        : Promise.resolve([]),
    ]);
    const accounting = user.permissions.includes("accounting.view") ? (() => {
      const inventoryValue = batches.reduce((sum, batch) => sum + Number(batch.quantityAvailable) * Number(batch.unitCost || 0), 0);
      const unvaluedUnits = batches.filter(batch => batch.unitCost == null && Number(batch.quantityAvailable) > 0).reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0);
      const sales = soldItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
      const costOfGoodsSold = soldItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost || 0), 0);
      const fastMoving = [...soldItems.reduce((map, item) => {
        const product = item.batch.catalogItem;
        const current = map.get(product.id) || { ...product, quantity: 0, sales: 0 };
        current.quantity += Number(item.quantity);
        current.sales += Number(item.quantity) * Number(item.unitPrice);
        map.set(product.id, current);
        return map;
      }, new Map<string, { id: string; code: string; name: string; quantity: number; sales: number }>()).values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
      return { inventoryValue, unvaluedUnits, sales, costOfGoodsSold, grossProfit: sales - costOfGoodsSold, fastMoving, journals };
    })() : null;
    const safeStocktakes = stocktakes.map(stocktake => ({
      ...stocktake,
      lines: stocktake.lines.map(line => ({ ...line, systemQuantity: stocktake.status === "OPEN" ? null : line.systemQuantity })),
    }));
    return NextResponse.json({ suppliers, stores, purchaseOrders, items, batches, pendingCounts, emergencyAdjustments, movements, stocktakes: safeStocktakes, accounting, currentUserId: user.id });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = actionSchema.parse(await request.json());
    const user = await requirePermission(permissions[input.action]);
    if ("idempotencyKey" in input) {
      const replay = await db.supplyOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (replay) return NextResponse.json({ result: replay, replayed: true });
    }
    const result = await db.$transaction(async tx => {
      if (input.action === "SUPPLIER") {
        const record = await tx.supplier.create({ data: { facilityId: user.facilityId, code: input.code.toUpperCase(), name: input.name, phone: input.phone, email: input.email } });
        await appendAudit(tx, { userId: user.id, action: "SUPPLIER_CREATED", entityType: "Supplier", entityId: record.id }); return record;
      }
      if (input.action === "STORE") {
        const record = await tx.store.create({ data: { facilityId: user.facilityId, code: input.code.toUpperCase(), name: input.name } });
        await appendAudit(tx, { userId: user.id, action: "STORE_CREATED", entityType: "Store", entityId: record.id }); return record;
      }
      if (input.action === "PURCHASE_ORDER") {
        const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, facilityId: user.facilityId, active: true } });
        const item = await tx.catalogItem.findFirst({ where: { id: input.catalogItemId, facilityId: user.facilityId, active: true } });
        if (!supplier || !item) fail("Active supplier or medicine was not found", 404);
        const unitCost = input.unitCost ?? Number(item.costPrice || 0);
        if (unitCost <= 0) fail("A positive unit cost is required so every receipt can be valued and reconciled.");
        const record = await tx.purchaseOrder.create({ data: { facilityId: user.facilityId, supplierId: supplier.id, orderNumber: `PO-${Date.now().toString(36).toUpperCase()}`, status: "DRAFT", expectedAt: input.expectedAt, notes: input.notes, createdById: user.id, idempotencyKey: input.idempotencyKey, lines: { create: { catalogItemId: item.id, quantityOrdered: new Prisma.Decimal(input.quantity), unitCost: new Prisma.Decimal(unitCost) } } }, include: { lines: true } });
        await tx.supplyOperation.create({ data: { facilityId: user.facilityId, idempotencyKey: input.idempotencyKey, action: input.action, entityType: "PurchaseOrder", entityId: record.id, createdById: user.id } });
        await appendAudit(tx, { userId: user.id, action: "PURCHASE_ORDER_DRAFTED", entityType: "PurchaseOrder", entityId: record.id }); return record;
      }
      if (input.action === "SUBMIT_PURCHASE_ORDER") {
        const order = await tx.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, facilityId: user.facilityId } });
        if (!order) fail("Purchase order was not found", 404); if (!canTransitionPurchaseOrder(order.status, "SUBMITTED")) fail(`Only a draft order can be submitted; this order is ${order.status}.`);
        const record = await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: "SUBMITTED", submittedAt: new Date(), submittedById: user.id } });
        await appendAudit(tx, { userId: user.id, action: "PURCHASE_ORDER_SUBMITTED", entityType: "PurchaseOrder", entityId: record.id }); return record;
      }
      if (input.action === "APPROVE_PURCHASE_ORDER") {
        const order = await tx.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, facilityId: user.facilityId } });
        if (!order) fail("Purchase order was not found", 404); if (!canTransitionPurchaseOrder(order.status, "APPROVED")) fail(`Only a submitted order can be approved; this order is ${order.status}.`);
        if (!isIndependentChecker(user.id, order.createdById, order.submittedById)) fail("Maker-checker control: the person who created or submitted this order cannot approve it.", 403);
        const record = await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: user.id } });
        await appendAudit(tx, { userId: user.id, action: "PURCHASE_ORDER_APPROVED", entityType: "PurchaseOrder", entityId: record.id }); return record;
      }
      if (input.action === "CANCEL_PURCHASE_ORDER") {
        const order = await tx.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, facilityId: user.facilityId } });
        if (!order) fail("Purchase order was not found", 404); if (!canTransitionPurchaseOrder(order.status, "CANCELLED")) fail(`A ${order.status.toLowerCase()} order cannot be cancelled.`);
        const record = await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id, cancellationReason: input.reason } });
        await appendAudit(tx, { userId: user.id, action: "PURCHASE_ORDER_CANCELLED", entityType: "PurchaseOrder", entityId: record.id, reason: input.reason }); return record;
      }
      if (input.action === "RECEIVE") return receive(tx, user, input);
      if (input.action === "CORRECT_BATCH_EXPIRY") return correctBatchExpiry(tx, user, input);
      if (input.action === "COUNT") {
        await assertStoresNotFrozen(tx, user.facilityId, [input.storeId]);
        const balance = await tx.inventoryLocationBalance.findFirst({ where: { storeId: input.storeId, batchId: input.batchId, store: { facilityId: user.facilityId } } });
        if (!balance) fail("This batch is not held in the selected store", 404);
        const emergency = await tx.inventoryControlEvent.findFirst({ where: { facilityId: user.facilityId, storeId: input.storeId, batchId: input.batchId, type: "EMERGENCY_ADJUSTMENT", status: "RECONCILIATION_REQUIRED" } });
        if (emergency?.recordedById === user.id) fail("The person who made an emergency adjustment cannot perform its reconciliation count.", 403);
        const variance = input.countedQuantity - Number(balance.quantity);
        const record = await tx.inventoryControlEvent.create({ data: { facilityId: user.facilityId, type: "STOCK_COUNT", storeId: input.storeId, batchId: input.batchId, quantity: input.countedQuantity, variance, reason: input.reason, recordedById: user.id, status: countDisposition(variance), idempotencyKey: input.idempotencyKey } });
        if (variance === 0) await tx.inventoryControlEvent.updateMany({ where: { facilityId: user.facilityId, storeId: input.storeId, batchId: input.batchId, type: "EMERGENCY_ADJUSTMENT", status: "RECONCILIATION_REQUIRED" }, data: { status: "RECONCILED", approvedById: user.id, approvedAt: new Date() } });
        await operation(tx, user, input.idempotencyKey, input.action, "InventoryControlEvent", record.id);
        await appendAudit(tx, { userId: user.id, action: variance === 0 ? "STOCK_COUNT_MATCHED" : "STOCK_COUNT_SUBMITTED", entityType: "InventoryControlEvent", entityId: record.id, reason: input.reason, afterHash: `${input.countedQuantity}:${variance}` }); return record;
      }
      if (input.action === "APPROVE_COUNT") return approveCount(tx, user, input.eventId);
      if (input.action === "EMERGENCY_ADJUST") return emergencyAdjust(tx, user, input);
      if (input.action === "START_STOCKTAKE") return startStocktake(tx, user, input);
      if (input.action === "SUBMIT_STOCKTAKE") return submitStocktake(tx, user, input);
      if (input.action === "APPROVE_STOCKTAKE") return approveStocktake(tx, user, input);
      if (input.action === "CANCEL_STOCKTAKE") return cancelStocktake(tx, user, input);
      return transfer(tx, user, input);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "This transaction was already recorded. Refresh to view the saved result." }, { status: 409 });
    return apiError(error);
  }
}

type Tx = Prisma.TransactionClient;
type User = { id: string; facilityId: string };
async function operation(tx: Tx, user: User, idempotencyKey: string, action: string, entityType: string, entityId: string) { await tx.supplyOperation.create({ data: { facilityId: user.facilityId, idempotencyKey, action, entityType, entityId, createdById: user.id } }); }

async function receive(tx: Tx, user: User, input: Extract<z.infer<typeof actionSchema>, { action: "RECEIVE" }>) {
  if (input.expiryDate <= new Date()) fail("Expired stock cannot be received");
  const line = await tx.purchaseOrderLine.findFirst({ where: { id: input.lineId, purchaseOrder: { facilityId: user.facilityId } }, include: { purchaseOrder: true } });
  const store = await tx.store.findFirst({ where: { id: input.storeId, facilityId: user.facilityId, active: true } });
  if (!line || !store) fail("Purchase-order line or receiving store was not found", 404);
  await assertStoresNotFrozen(tx, user.facilityId, [store.id]);
  if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(line.purchaseOrder.status)) fail(`Goods can only be received against an approved order; this order is ${line.purchaseOrder.status}.`);
  const outstanding = Number(line.quantityOrdered) - Number(line.quantityReceived); if (input.quantity > outstanding) fail(`Receipt exceeds the outstanding ordered quantity of ${outstanding}`);
  const existing = await tx.inventoryBatch.findUnique({ where: { catalogItemId_batchNumber: { catalogItemId: line.catalogItemId, batchNumber: input.batchNumber } } });
  if (existing && existing.expiryDate.toISOString().slice(0, 10) !== input.expiryDate.toISOString().slice(0, 10))
    fail(`Batch ${input.batchNumber} already exists with expiry ${existing.expiryDate.toISOString().slice(0, 10)}. Correct its expiry first or use the matching date.`);
  const receiptUnitCost = Number(line.unitCost);
  const batchUnitCost = existing
    ? weightedAverageUnitCost(Number(existing.quantityAvailable), existing.unitCost == null ? null : Number(existing.unitCost), input.quantity, receiptUnitCost)
    : receiptUnitCost;
  const batch = existing ? await tx.inventoryBatch.update({ where: { id: existing.id }, data: { quantityReceived: { increment: input.quantity }, quantityAvailable: { increment: input.quantity }, unitCost: new Prisma.Decimal(batchUnitCost), active: true } }) : await tx.inventoryBatch.create({ data: { catalogItemId: line.catalogItemId, batchNumber: input.batchNumber, expiryDate: input.expiryDate, quantityReceived: input.quantity, quantityAvailable: input.quantity, unitCost: new Prisma.Decimal(batchUnitCost) } });
  const destinationBalance = await tx.inventoryLocationBalance.upsert({ where: { storeId_batchId: { storeId: store.id, batchId: batch.id } }, update: { quantity: { increment: input.quantity } }, create: { storeId: store.id, batchId: batch.id, quantity: input.quantity } });
  const updated = await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { quantityReceived: { increment: input.quantity } } });
  const complete = Number(updated.quantityReceived) >= Number(updated.quantityOrdered);
  await tx.purchaseOrder.update({ where: { id: line.purchaseOrderId }, data: complete ? { status: "RECEIVED", receivedAt: new Date() } : { status: "PARTIALLY_RECEIVED" } });
  const movement = await tx.stockMovement.create({ data: { batchId: batch.id, userId: user.id, destinationStoreId: store.id, type: "RECEIPT", quantity: input.quantity, balanceAfter: batch.quantityAvailable, destinationBalanceAfter: destinationBalance.quantity, reason: `${line.purchaseOrder.orderNumber} · GRN to ${store.name}` } });
  await postInventoryJournal(tx, { facilityId: user.facilityId, postedById: user.id, sourceType: "STOCK_MOVEMENT", sourceId: movement.id, description: `Goods receipt ${line.purchaseOrder.orderNumber} · ${input.batchNumber}`, movementType: "RECEIPT", signedQuantity: input.quantity, unitCost: receiptUnitCost, catalogItemId: line.catalogItemId, batchId: batch.id, storeId: store.id, occurredAt: movement.occurredAt });
  await operation(tx, user, input.idempotencyKey, input.action, "InventoryBatch", batch.id);
  await appendAudit(tx, { userId: user.id, action: "GOODS_RECEIVED", entityType: "PurchaseOrder", entityId: line.purchaseOrderId, afterHash: `${batch.id}:${input.quantity}:${store.id}` }); return batch;
}

async function correctBatchExpiry(tx: Tx, user: User, input: Extract<z.infer<typeof actionSchema>, { action: "CORRECT_BATCH_EXPIRY" }>) {
  const batch = await tx.inventoryBatch.findFirst({
    where: { id: input.batchId, catalogItem: { facilityId: user.facilityId } },
    include: { catalogItem: { select: { name: true } } },
  });
  if (!batch) fail("Stock batch was not found", 404);
  const before = batch.expiryDate.toISOString().slice(0, 10);
  const after = input.expiryDate.toISOString().slice(0, 10);
  if (before === after) fail("Enter a different expiry date");
  const corrected = await tx.inventoryBatch.update({ where: { id: batch.id }, data: { expiryDate: input.expiryDate } });
  await tx.stockMovement.create({ data: { batchId: batch.id, userId: user.id, type: "EXPIRY_CORRECTION", quantity: 0, balanceAfter: batch.quantityAvailable, reason: `${input.reason} · expiry ${before} → ${after}` } });
  await operation(tx, user, input.idempotencyKey, input.action, "InventoryBatch", batch.id);
  await appendAudit(tx, { userId: user.id, action: "STOCK_EXPIRY_CORRECTED", entityType: "InventoryBatch", entityId: batch.id, reason: input.reason, beforeHash: `${batch.batchNumber}:${before}`, afterHash: `${batch.batchNumber}:${after}` });
  return corrected;
}

async function approveCount(tx: Tx, user: User, eventId: string) {
  const event = await tx.inventoryControlEvent.findFirst({ where: { id: eventId, facilityId: user.facilityId, type: "STOCK_COUNT" } });
  if (!event) fail("Stock count was not found", 404); if (event.status !== "PENDING") fail(`Only a pending stock variance can be approved; this count is ${event.status}.`); if (!isIndependentChecker(user.id, event.recordedById)) fail("Maker-checker control: the person who counted the stock cannot approve its variance.", 403);
  const balance = await tx.inventoryLocationBalance.findUnique({ where: { storeId_batchId: { storeId: event.storeId, batchId: event.batchId } } }); if (!balance) fail("The counted stock balance no longer exists", 409);
  await assertStoresNotFrozen(tx, user.facilityId, [event.storeId]);
  const variance = Number(event.quantity) - Number(balance.quantity);
  const batch = await tx.inventoryBatch.update({ where: { id: event.batchId }, data: { quantityAvailable: { increment: variance } } });
  await tx.inventoryBatch.update({ where: { id: event.batchId }, data: { active: Number(batch.quantityAvailable) > 0 } });
  await tx.inventoryLocationBalance.update({ where: { id: balance.id }, data: { quantity: event.quantity } });
  const record = await tx.inventoryControlEvent.update({ where: { id: event.id }, data: { variance, status: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
  const movement = await tx.stockMovement.create({ data: { batchId: event.batchId, userId: user.id, sourceStoreId: event.storeId, type: "ADJUSTMENT", quantity: variance, balanceAfter: batch.quantityAvailable, sourceBalanceAfter: event.quantity, reason: event.reason } });
  await postInventoryJournal(tx, { facilityId: user.facilityId, postedById: user.id, sourceType: "STOCK_MOVEMENT", sourceId: movement.id, description: `Approved stock variance · ${event.reason}`, movementType: "ADJUSTMENT", signedQuantity: variance, unitCost: batch.unitCost == null ? null : Number(batch.unitCost), catalogItemId: undefined, batchId: event.batchId, storeId: event.storeId, occurredAt: movement.occurredAt });
  await tx.inventoryControlEvent.updateMany({ where: { facilityId: user.facilityId, storeId: event.storeId, batchId: event.batchId, type: "EMERGENCY_ADJUSTMENT", status: "RECONCILIATION_REQUIRED" }, data: { status: "RECONCILED", approvedById: user.id, approvedAt: new Date() } });
  await appendAudit(tx, { userId: user.id, action: "STOCK_COUNT_APPROVED", entityType: "InventoryControlEvent", entityId: record.id, reason: record.reason, afterHash: `${record.quantity}:${variance}` }); return record;
}

async function emergencyAdjust(tx: Tx, user: User, input: Extract<z.infer<typeof actionSchema>, { action: "EMERGENCY_ADJUST" }>) {
  await assertStoresNotFrozen(tx, user.facilityId, [input.storeId]);
  const balance = await tx.inventoryLocationBalance.findFirst({ where: { storeId: input.storeId, batchId: input.batchId, store: { facilityId: user.facilityId } } });
  if (!balance) fail("This batch is not held in the selected store", 404);
  const pending = await tx.inventoryControlEvent.findFirst({ where: { facilityId: user.facilityId, storeId: input.storeId, batchId: input.batchId, type: "EMERGENCY_ADJUSTMENT", status: "RECONCILIATION_REQUIRED" } });
  if (pending) fail("This batch already has an emergency correction awaiting physical count. Reconcile it before another correction.", 409);
  const variance = input.newQuantity - Number(balance.quantity);
  const batch = await tx.inventoryBatch.update({ where: { id: input.batchId }, data: { quantityAvailable: { increment: variance } } });
  await tx.inventoryBatch.update({ where: { id: input.batchId }, data: { active: Number(batch.quantityAvailable) > 0 } });
  await tx.inventoryLocationBalance.update({ where: { id: balance.id }, data: { quantity: input.newQuantity } });
  const record = await tx.inventoryControlEvent.create({ data: { facilityId: user.facilityId, type: "EMERGENCY_ADJUSTMENT", storeId: input.storeId, batchId: input.batchId, quantity: input.newQuantity, variance, reason: input.reason, recordedById: user.id, status: "RECONCILIATION_REQUIRED", idempotencyKey: input.idempotencyKey } });
  const movement = await tx.stockMovement.create({ data: { batchId: input.batchId, userId: user.id, sourceStoreId: input.storeId, type: "EMERGENCY_ADJUSTMENT", quantity: variance, balanceAfter: batch.quantityAvailable, sourceBalanceAfter: input.newQuantity, reason: input.reason } });
  await postInventoryJournal(tx, { facilityId: user.facilityId, postedById: user.id, sourceType: "STOCK_MOVEMENT", sourceId: movement.id, description: `Emergency stock correction · ${input.reason}`, movementType: "EMERGENCY_ADJUSTMENT", signedQuantity: variance, unitCost: batch.unitCost == null ? null : Number(batch.unitCost), batchId: input.batchId, storeId: input.storeId, occurredAt: movement.occurredAt });
  await operation(tx, user, input.idempotencyKey, input.action, "InventoryControlEvent", record.id);
  await appendAudit(tx, { userId: user.id, action: "EMERGENCY_STOCK_ADJUSTED", entityType: "InventoryControlEvent", entityId: record.id, reason: input.reason, afterHash: `${input.newQuantity}:${variance}` }); return record;
}

async function startStocktake(tx: Tx, user: User, input: Extract<z.infer<typeof actionSchema>, { action: "START_STOCKTAKE" }>) {
  const store = await tx.store.findFirst({ where: { id: input.storeId, facilityId: user.facilityId, active: true } });
  if (!store) fail("Active stocktake store was not found", 404);
  await assertStoresNotFrozen(tx, user.facilityId, [store.id]);
  const balances = await tx.inventoryLocationBalance.findMany({
    where: { storeId: store.id },
    include: { batch: { include: { catalogItem: { select: { code: true, name: true } } } } },
    orderBy: [{ batch: { catalogItem: { name: "asc" } } }, { batch: { expiryDate: "asc" } }],
  });
  if (!balances.length) fail("This store has no batch balances to count");
  const [facility, sequence] = await Promise.all([
    tx.facility.findUniqueOrThrow({ where: { id: user.facilityId }, select: { code: true } }),
    tx.referenceSequence.upsert({
      where: { facilityId_kind_year: { facilityId: user.facilityId, kind: "STOCKTAKE", year: new Date().getFullYear() } },
      update: { nextValue: { increment: 1 } },
      create: { facilityId: user.facilityId, kind: "STOCKTAKE", year: new Date().getFullYear(), nextValue: 2 },
    }),
  ]);
  const year = new Date().getFullYear();
  const stocktakeNumber = `${facility.code}-STK-${year}-${(sequence.nextValue - 1n).toString().padStart(6, "0")}`;
  const record = await tx.stocktake.create({
    data: {
      facilityId: user.facilityId,
      storeId: store.id,
      stocktakeNumber,
      notes: input.notes,
      openedById: user.id,
      lines: {
        create: balances.map((balance) => ({
          batchId: balance.batchId,
          systemQuantity: balance.quantity,
          unitCost: balance.batch.unitCost,
        })),
      },
    },
    include: { store: true, lines: { include: { batch: { include: { catalogItem: true } } } } },
  });
  await operation(tx, user, input.idempotencyKey, input.action, "Stocktake", record.id);
  await appendAudit(tx, { userId: user.id, action: "STOCKTAKE_STARTED", entityType: "Stocktake", entityId: record.id, reason: input.notes, afterHash: `${record.stocktakeNumber}:${record.lines.length}:${record.storeId}` });
  return record;
}

async function submitStocktake(tx: Tx, user: User, input: Extract<z.infer<typeof actionSchema>, { action: "SUBMIT_STOCKTAKE" }>) {
  const stocktake = await tx.stocktake.findFirst({
    where: { id: input.stocktakeId, facilityId: user.facilityId },
    include: { store: true, lines: { include: { batch: { include: { catalogItem: { select: { name: true } } } } } } },
  });
  if (!stocktake) fail("Stocktake was not found", 404);
  if (stocktake.status !== "OPEN") fail(`Only an open stocktake can be submitted; this stocktake is ${stocktake.status}.`);
  const submitted = new Map(input.lines.map((line) => [line.lineId, line]));
  if (submitted.size !== input.lines.length) fail("Each stocktake line can be submitted only once");
  if (submitted.size !== stocktake.lines.length || stocktake.lines.some((line) => !submitted.has(line.id)))
    fail("Count every stocktake line before submission");
  const countedAt = new Date();
  let varianceLines = 0;
  for (const line of stocktake.lines) {
    const value = submitted.get(line.id)!;
    let variance: number;
    try {
      variance = stocktakeVariance(Number(line.systemQuantity), value.countedQuantity, value.reason);
    } catch (error) {
      fail(`${line.batch.catalogItem.name} batch ${line.batch.batchNumber}: ${(error as Error).message}`);
    }
    if (variance !== 0) varianceLines += 1;
    await tx.stocktakeLine.update({
      where: { id: line.id },
      data: {
        countedQuantity: new Prisma.Decimal(value.countedQuantity),
        variance: new Prisma.Decimal(variance),
        reason: value.reason,
        countedById: user.id,
        countedAt,
      },
    });
  }
  const record = await tx.stocktake.update({
    where: { id: stocktake.id },
    data: { status: "SUBMITTED", submittedById: user.id, submittedAt: countedAt },
  });
  await operation(tx, user, input.idempotencyKey, input.action, "Stocktake", record.id);
  await appendAudit(tx, { userId: user.id, action: "STOCKTAKE_SUBMITTED", entityType: "Stocktake", entityId: record.id, afterHash: `${record.stocktakeNumber}:${stocktake.lines.length}:${varianceLines}` });
  return record;
}

async function approveStocktake(tx: Tx, user: User, input: Extract<z.infer<typeof actionSchema>, { action: "APPROVE_STOCKTAKE" }>) {
  const stocktake = await tx.stocktake.findFirst({
    where: { id: input.stocktakeId, facilityId: user.facilityId },
    include: { store: true, lines: { include: { batch: { include: { catalogItem: { select: { id: true, name: true } } } } } } },
  });
  if (!stocktake) fail("Stocktake was not found", 404);
  if (stocktake.status !== "SUBMITTED") fail(`Only a submitted stocktake can be approved; this stocktake is ${stocktake.status}.`);
  if (!isIndependentChecker(user.id, stocktake.openedById, stocktake.submittedById))
    fail("Maker-checker control: the person who opened or submitted this stocktake cannot approve it.", 403);
  let postedVariance = 0;
  for (const line of stocktake.lines) {
    if (line.countedQuantity == null || line.variance == null) fail("The stocktake has an incomplete count line", 409);
    const balance = await tx.inventoryLocationBalance.findUnique({ where: { storeId_batchId: { storeId: stocktake.storeId, batchId: line.batchId } } });
    if (!balance) fail(`Batch ${line.batch.batchNumber} no longer has a store balance`, 409);
    if (Math.abs(Number(balance.quantity) - Number(line.systemQuantity)) > 0.000001)
      fail(`Batch ${line.batch.batchNumber} changed after this stocktake started. Cancel it and start a new count.`, 409);
    const variance = stocktakeVariance(Number(line.systemQuantity), Number(line.countedQuantity), line.reason);
    postedVariance += Math.abs(variance);
    if (variance === 0) continue;
    const batch = await tx.inventoryBatch.update({ where: { id: line.batchId }, data: { quantityAvailable: { increment: variance } } });
    await tx.inventoryBatch.update({ where: { id: line.batchId }, data: { active: Number(batch.quantityAvailable) > 0 } });
    await tx.inventoryLocationBalance.update({ where: { id: balance.id }, data: { quantity: line.countedQuantity } });
    const movement = await tx.stockMovement.create({ data: { batchId: line.batchId, userId: user.id, sourceStoreId: stocktake.storeId, type: "STOCKTAKE_ADJUSTMENT", quantity: new Prisma.Decimal(variance), balanceAfter: batch.quantityAvailable, sourceBalanceAfter: line.countedQuantity, reason: `${stocktake.stocktakeNumber} · ${line.reason}` } });
    await postInventoryJournal(tx, { facilityId: user.facilityId, postedById: user.id, sourceType: "STOCK_MOVEMENT", sourceId: movement.id, description: `${stocktake.stocktakeNumber} · ${line.batch.catalogItem.name}`, movementType: "STOCKTAKE_ADJUSTMENT", signedQuantity: variance, unitCost: line.unitCost == null ? null : Number(line.unitCost), catalogItemId: line.batch.catalogItem.id, batchId: line.batchId, storeId: stocktake.storeId, occurredAt: movement.occurredAt });
  }
  await tx.inventoryControlEvent.updateMany({
    where: { facilityId: user.facilityId, storeId: stocktake.storeId, type: "EMERGENCY_ADJUSTMENT", status: "RECONCILIATION_REQUIRED" },
    data: { status: "RECONCILED", approvedById: user.id, approvedAt: new Date() },
  });
  const record = await tx.stocktake.update({ where: { id: stocktake.id }, data: { status: "POSTED", approvedById: user.id, approvedAt: new Date() } });
  await operation(tx, user, input.idempotencyKey, input.action, "Stocktake", record.id);
  await appendAudit(tx, { userId: user.id, action: "STOCKTAKE_POSTED", entityType: "Stocktake", entityId: record.id, afterHash: `${record.stocktakeNumber}:${stocktake.lines.length}:${postedVariance}` });
  return record;
}

async function cancelStocktake(tx: Tx, user: User, input: Extract<z.infer<typeof actionSchema>, { action: "CANCEL_STOCKTAKE" }>) {
  const stocktake = await tx.stocktake.findFirst({ where: { id: input.stocktakeId, facilityId: user.facilityId } });
  if (!stocktake) fail("Stocktake was not found", 404);
  if (!["OPEN", "SUBMITTED"].includes(stocktake.status)) fail(`A ${stocktake.status.toLowerCase()} stocktake cannot be cancelled.`);
  const record = await tx.stocktake.update({ where: { id: stocktake.id }, data: { status: "CANCELLED" } });
  await appendAudit(tx, { userId: user.id, action: "STOCKTAKE_CANCELLED", entityType: "Stocktake", entityId: record.id, reason: input.reason, beforeHash: stocktake.status, afterHash: "CANCELLED" });
  return record;
}

async function transfer(tx: Tx, user: User, input: Extract<z.infer<typeof actionSchema>, { action: "TRANSFER" }>) {
  if (input.sourceStoreId === input.destinationStoreId) fail("Source and destination stores must be different");
  await assertStoresNotFrozen(tx, user.facilityId, [input.sourceStoreId, input.destinationStoreId]);
  const source = await tx.inventoryLocationBalance.findFirst({ where: { storeId: input.sourceStoreId, batchId: input.batchId, store: { facilityId: user.facilityId } }, include: { batch: true } });
  const destination = await tx.store.findFirst({ where: { id: input.destinationStoreId, facilityId: user.facilityId, active: true } });
  if (!source || !destination) fail("Source stock or destination store was not found", 404); if (Number(source.quantity) < input.quantity) fail(`Only ${Number(source.quantity)} units are available in the source store`);
  const sourceBalance = await tx.inventoryLocationBalance.update({ where: { id: source.id }, data: { quantity: { decrement: input.quantity } } });
  const destinationBalance = await tx.inventoryLocationBalance.upsert({ where: { storeId_batchId: { storeId: destination.id, batchId: input.batchId } }, update: { quantity: { increment: input.quantity } }, create: { storeId: destination.id, batchId: input.batchId, quantity: input.quantity } });
  const record = await tx.inventoryControlEvent.create({ data: { facilityId: user.facilityId, type: "TRANSFER", storeId: input.sourceStoreId, destinationStoreId: input.destinationStoreId, batchId: input.batchId, quantity: input.quantity, reason: input.reason, recordedById: user.id, idempotencyKey: input.idempotencyKey } });
  await tx.stockMovement.create({ data: { batchId: input.batchId, userId: user.id, sourceStoreId: input.sourceStoreId, destinationStoreId: input.destinationStoreId, type: "TRANSFER", quantity: input.quantity, balanceAfter: source.batch.quantityAvailable, sourceBalanceAfter: sourceBalance.quantity, destinationBalanceAfter: destinationBalance.quantity, reason: input.reason } });
  await operation(tx, user, input.idempotencyKey, input.action, "InventoryControlEvent", record.id);
  await appendAudit(tx, { userId: user.id, action: "STOCK_TRANSFERRED", entityType: "InventoryControlEvent", entityId: record.id, reason: input.reason }); return record;
}
