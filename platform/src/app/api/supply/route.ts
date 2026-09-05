import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { canTransitionPurchaseOrder, countDisposition, isIndependentChecker } from "@/lib/supply-controls";

const key = z.string().uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SUPPLIER"), code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(160), phone: z.string().trim().max(30).optional(), email: z.email().optional() }),
  z.object({ action: z.literal("STORE"), code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(120) }),
  z.object({ action: z.literal("PURCHASE_ORDER"), idempotencyKey: key, supplierId: z.uuid(), catalogItemId: z.uuid(), quantity: z.coerce.number().positive(), unitCost: z.coerce.number().nonnegative().optional(), expectedAt: z.coerce.date().optional(), notes: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("SUBMIT_PURCHASE_ORDER"), purchaseOrderId: z.uuid() }),
  z.object({ action: z.literal("APPROVE_PURCHASE_ORDER"), purchaseOrderId: z.uuid() }),
  z.object({ action: z.literal("CANCEL_PURCHASE_ORDER"), purchaseOrderId: z.uuid(), reason: z.string().trim().min(5).max(240) }),
  z.object({ action: z.literal("RECEIVE"), idempotencyKey: key, lineId: z.uuid(), storeId: z.uuid(), batchNumber: z.string().trim().min(1).max(80), expiryDate: z.coerce.date(), quantity: z.coerce.number().positive() }),
  z.object({ action: z.literal("COUNT"), idempotencyKey: key, storeId: z.uuid(), batchId: z.uuid(), countedQuantity: z.coerce.number().nonnegative(), reason: z.string().trim().min(5).max(240) }),
  z.object({ action: z.literal("APPROVE_COUNT"), eventId: z.uuid() }),
  z.object({ action: z.literal("TRANSFER"), idempotencyKey: key, sourceStoreId: z.uuid(), destinationStoreId: z.uuid(), batchId: z.uuid(), quantity: z.coerce.number().positive(), reason: z.string().trim().min(5).max(240) }),
]);
const permissions: Record<string, string> = { SUPPLIER: "procurement.manage_suppliers", STORE: "inventory.manage_stores", PURCHASE_ORDER: "procurement.create", SUBMIT_PURCHASE_ORDER: "procurement.create", APPROVE_PURCHASE_ORDER: "procurement.approve", CANCEL_PURCHASE_ORDER: "procurement.approve", RECEIVE: "inventory.receive", COUNT: "inventory.count", APPROVE_COUNT: "inventory.adjust", TRANSFER: "inventory.transfer" };
function fail(message: string, status = 422): never { throw Object.assign(new Error(message), { status }); }

export async function GET() {
  try {
    const user = await requirePermission("inventory.view");
    const [suppliers, stores, purchaseOrders, items, batches, pendingCounts] = await Promise.all([
      db.supplier.findMany({ where: { facilityId: user.facilityId, active: true }, orderBy: { name: "asc" } }),
      db.store.findMany({ where: { facilityId: user.facilityId, active: true }, include: { balances: { include: { batch: { include: { catalogItem: { select: { name: true, code: true } } } } } } }, orderBy: { name: "asc" } }),
      db.purchaseOrder.findMany({ where: { facilityId: user.facilityId }, include: { supplier: true, lines: true }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.catalogItem.findMany({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
      db.inventoryBatch.findMany({ where: { catalogItem: { facilityId: user.facilityId }, active: true }, include: { catalogItem: { select: { name: true, code: true } }, locationBalances: { include: { store: true } } }, orderBy: { expiryDate: "asc" } }),
      db.inventoryControlEvent.findMany({ where: { facilityId: user.facilityId, type: "STOCK_COUNT", status: "PENDING" }, orderBy: { occurredAt: "asc" } }),
    ]);
    return NextResponse.json({ suppliers, stores, purchaseOrders, items, batches, pendingCounts, currentUserId: user.id });
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
        const record = await tx.purchaseOrder.create({ data: { facilityId: user.facilityId, supplierId: supplier.id, orderNumber: `PO-${Date.now().toString(36).toUpperCase()}`, status: "DRAFT", expectedAt: input.expectedAt, notes: input.notes, createdById: user.id, idempotencyKey: input.idempotencyKey, lines: { create: { catalogItemId: item.id, quantityOrdered: new Prisma.Decimal(input.quantity), unitCost: input.unitCost == null ? undefined : new Prisma.Decimal(input.unitCost) } } }, include: { lines: true } });
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
      if (input.action === "COUNT") {
        const balance = await tx.inventoryLocationBalance.findFirst({ where: { storeId: input.storeId, batchId: input.batchId, store: { facilityId: user.facilityId } } });
        if (!balance) fail("This batch is not held in the selected store", 404);
        const variance = input.countedQuantity - Number(balance.quantity);
        const record = await tx.inventoryControlEvent.create({ data: { facilityId: user.facilityId, type: "STOCK_COUNT", storeId: input.storeId, batchId: input.batchId, quantity: input.countedQuantity, variance, reason: input.reason, recordedById: user.id, status: countDisposition(variance), idempotencyKey: input.idempotencyKey } });
        await operation(tx, user, input.idempotencyKey, input.action, "InventoryControlEvent", record.id);
        await appendAudit(tx, { userId: user.id, action: variance === 0 ? "STOCK_COUNT_MATCHED" : "STOCK_COUNT_SUBMITTED", entityType: "InventoryControlEvent", entityId: record.id, reason: input.reason, afterHash: `${input.countedQuantity}:${variance}` }); return record;
      }
      if (input.action === "APPROVE_COUNT") return approveCount(tx, user, input.eventId);
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
  if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(line.purchaseOrder.status)) fail(`Goods can only be received against an approved order; this order is ${line.purchaseOrder.status}.`);
  const outstanding = Number(line.quantityOrdered) - Number(line.quantityReceived); if (input.quantity > outstanding) fail(`Receipt exceeds the outstanding ordered quantity of ${outstanding}`);
  const existing = await tx.inventoryBatch.findUnique({ where: { catalogItemId_batchNumber: { catalogItemId: line.catalogItemId, batchNumber: input.batchNumber } } });
  const batch = existing ? await tx.inventoryBatch.update({ where: { id: existing.id }, data: { quantityReceived: { increment: input.quantity }, quantityAvailable: { increment: input.quantity }, expiryDate: input.expiryDate, unitCost: line.unitCost } }) : await tx.inventoryBatch.create({ data: { catalogItemId: line.catalogItemId, batchNumber: input.batchNumber, expiryDate: input.expiryDate, quantityReceived: input.quantity, quantityAvailable: input.quantity, unitCost: line.unitCost } });
  await tx.inventoryLocationBalance.upsert({ where: { storeId_batchId: { storeId: store.id, batchId: batch.id } }, update: { quantity: { increment: input.quantity } }, create: { storeId: store.id, batchId: batch.id, quantity: input.quantity } });
  const updated = await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { quantityReceived: { increment: input.quantity } } });
  const complete = Number(updated.quantityReceived) >= Number(updated.quantityOrdered);
  await tx.purchaseOrder.update({ where: { id: line.purchaseOrderId }, data: complete ? { status: "RECEIVED", receivedAt: new Date() } : { status: "PARTIALLY_RECEIVED" } });
  await tx.stockMovement.create({ data: { batchId: batch.id, userId: user.id, type: "RECEIPT", quantity: input.quantity, balanceAfter: batch.quantityAvailable, reason: `${line.purchaseOrder.orderNumber} · GRN to ${store.name}` } });
  await operation(tx, user, input.idempotencyKey, input.action, "InventoryBatch", batch.id);
  await appendAudit(tx, { userId: user.id, action: "GOODS_RECEIVED", entityType: "PurchaseOrder", entityId: line.purchaseOrderId, afterHash: `${batch.id}:${input.quantity}:${store.id}` }); return batch;
}

async function approveCount(tx: Tx, user: User, eventId: string) {
  const event = await tx.inventoryControlEvent.findFirst({ where: { id: eventId, facilityId: user.facilityId, type: "STOCK_COUNT" } });
  if (!event) fail("Stock count was not found", 404); if (event.status !== "PENDING") fail(`Only a pending stock variance can be approved; this count is ${event.status}.`); if (!isIndependentChecker(user.id, event.recordedById)) fail("Maker-checker control: the person who counted the stock cannot approve its variance.", 403);
  const balance = await tx.inventoryLocationBalance.findUnique({ where: { storeId_batchId: { storeId: event.storeId, batchId: event.batchId } } }); if (!balance) fail("The counted stock balance no longer exists", 409);
  const variance = Number(event.quantity) - Number(balance.quantity);
  const batch = await tx.inventoryBatch.update({ where: { id: event.batchId }, data: { quantityAvailable: { increment: variance } } });
  await tx.inventoryLocationBalance.update({ where: { id: balance.id }, data: { quantity: event.quantity } });
  const record = await tx.inventoryControlEvent.update({ where: { id: event.id }, data: { variance, status: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
  await tx.stockMovement.create({ data: { batchId: event.batchId, userId: user.id, type: "ADJUSTMENT", quantity: variance, balanceAfter: batch.quantityAvailable, reason: event.reason } });
  await appendAudit(tx, { userId: user.id, action: "STOCK_COUNT_APPROVED", entityType: "InventoryControlEvent", entityId: record.id, reason: record.reason, afterHash: `${record.quantity}:${variance}` }); return record;
}

async function transfer(tx: Tx, user: User, input: Extract<z.infer<typeof actionSchema>, { action: "TRANSFER" }>) {
  if (input.sourceStoreId === input.destinationStoreId) fail("Source and destination stores must be different");
  const source = await tx.inventoryLocationBalance.findFirst({ where: { storeId: input.sourceStoreId, batchId: input.batchId, store: { facilityId: user.facilityId } } });
  const destination = await tx.store.findFirst({ where: { id: input.destinationStoreId, facilityId: user.facilityId, active: true } });
  if (!source || !destination) fail("Source stock or destination store was not found", 404); if (Number(source.quantity) < input.quantity) fail(`Only ${Number(source.quantity)} units are available in the source store`);
  await tx.inventoryLocationBalance.update({ where: { id: source.id }, data: { quantity: { decrement: input.quantity } } });
  await tx.inventoryLocationBalance.upsert({ where: { storeId_batchId: { storeId: destination.id, batchId: input.batchId } }, update: { quantity: { increment: input.quantity } }, create: { storeId: destination.id, batchId: input.batchId, quantity: input.quantity } });
  const record = await tx.inventoryControlEvent.create({ data: { facilityId: user.facilityId, type: "TRANSFER", storeId: input.sourceStoreId, destinationStoreId: input.destinationStoreId, batchId: input.batchId, quantity: input.quantity, reason: input.reason, recordedById: user.id, idempotencyKey: input.idempotencyKey } });
  await operation(tx, user, input.idempotencyKey, input.action, "InventoryControlEvent", record.id);
  await appendAudit(tx, { userId: user.id, action: "STOCK_TRANSFERRED", entityType: "InventoryControlEvent", entityId: record.id, reason: input.reason }); return record;
}
