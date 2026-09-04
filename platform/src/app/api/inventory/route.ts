import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
const schema = z.object({ catalogItemId: z.uuid(), batchNumber: z.string().trim().min(1).max(80), expiryDate: z.coerce.date(), quantity: z.coerce.number().positive().max(10000000), unitCost: z.coerce.number().nonnegative().max(100000000).optional() });
export async function GET() { try { const user = await requirePermission("visit.read"); const items = await db.catalogItem.findMany({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true }, include: { inventoryBatches: { where: { active: true }, include: { locationBalances: { include: { store: true } } }, orderBy: { expiryDate: "asc" } } }, orderBy: { name: "asc" } }); return NextResponse.json({ items }); } catch (error) { return apiError(error); } }
export async function POST(request: Request) {
  try {
    const user = await requirePermission("inventory.write"); const input = schema.parse(await request.json());
    if (input.expiryDate <= new Date()) throw Object.assign(new Error("Expired stock cannot be received"), { status: 422 });
    const result = await db.$transaction(async tx => {
      const item = await tx.catalogItem.findFirst({ where: { id: input.catalogItemId, facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true } });
      if (!item) throw Object.assign(new Error("Active medicine not found"), { status: 404 });
      const store = await tx.store.upsert({ where: { facilityId_code: { facilityId: user.facilityId, code: "MAIN" } }, update: { active: true }, create: { facilityId: user.facilityId, code: "MAIN", name: "Main pharmacy store" } });
      const existing = await tx.inventoryBatch.findUnique({ where: { catalogItemId_batchNumber: { catalogItemId: item.id, batchNumber: input.batchNumber } } });
      const batch = existing ? await tx.inventoryBatch.update({ where: { id: existing.id }, data: { quantityReceived: { increment: input.quantity }, quantityAvailable: { increment: input.quantity }, expiryDate: input.expiryDate, unitCost: input.unitCost === undefined ? existing.unitCost : new Prisma.Decimal(input.unitCost), active: true } }) : await tx.inventoryBatch.create({ data: { catalogItemId: item.id, batchNumber: input.batchNumber, expiryDate: input.expiryDate, quantityReceived: input.quantity, quantityAvailable: input.quantity, unitCost: input.unitCost } });
      await tx.inventoryLocationBalance.upsert({ where: { storeId_batchId: { storeId: store.id, batchId: batch.id } }, update: { quantity: { increment: input.quantity } }, create: { storeId: store.id, batchId: batch.id, quantity: input.quantity } });
      await tx.stockMovement.create({ data: { batchId: batch.id, userId: user.id, type: "RECEIPT", quantity: input.quantity, balanceAfter: batch.quantityAvailable, reason: `Direct receipt to ${store.name}` } });
      await appendAudit(tx, { userId: user.id, action: "STOCK_RECEIVED", entityType: "InventoryBatch", entityId: batch.id, afterHash: `${item.code}:${batch.batchNumber}:${input.quantity}:${store.code}` }); return batch;
    });
    return NextResponse.json({ batch: result }, { status: 201 });
  } catch (error) { return apiError(error); }
}
