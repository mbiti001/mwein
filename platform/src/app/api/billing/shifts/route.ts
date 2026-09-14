import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { cashierShiftTotals } from "@/lib/cashier-shifts";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("OPEN"), openingFloat: z.coerce.number().min(0).max(10000000) }),
  z.object({ action: z.literal("SUBMIT"), id: z.uuid(), countedCash: z.coerce.number().min(0).max(100000000), varianceReason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("APPROVE"), id: z.uuid(), reason: z.string().trim().max(500).optional() }),
]);

const include = { cashier: { select: { displayName: true, email: true } }, approvedBy: { select: { displayName: true } }, payments: { select: { amount: true, method: true, status: true } } } as const;

export async function GET() {
  try {
    const user = await requirePermission("billing.write");
    const shifts = await db.cashierShift.findMany({ where: { facilityId: user.facilityId, ...(user.permissions.includes("billing.approve_shift") ? {} : { cashierId: user.id }) }, include, orderBy: { openedAt: "desc" }, take: 40 });
    return NextResponse.json({ shifts: shifts.map(shift => ({ ...shift, isMine: shift.cashierId === user.id, totals: cashierShiftTotals(shift.openingFloat, shift.payments) })) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("billing.write");
    const input = schema.parse(await request.json());
    const shift = await db.$transaction(async tx => {
      if (input.action === "OPEN") {
        const existing = await tx.cashierShift.findFirst({ where: { cashierId: user.id, status: { in: ["OPEN", "SUBMITTED"] } } });
        if (existing) throw Object.assign(new Error("Complete and obtain approval for the current cashier shift first"), { status: 409 });
        const created = await tx.cashierShift.create({ data: { facilityId: user.facilityId, cashierId: user.id, openingFloat: new Prisma.Decimal(input.openingFloat) }, include });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "CASHIER_SHIFT_OPENED", entityType: "CashierShift", entityId: created.id, afterHash: String(input.openingFloat) });
        return created;
      }
      const existing = await tx.cashierShift.findFirst({ where: { id: input.id, facilityId: user.facilityId }, include });
      if (!existing) throw Object.assign(new Error("Cashier shift not found"), { status: 404 });
      if (input.action === "SUBMIT") {
        if (existing.cashierId !== user.id || existing.status !== "OPEN") throw Object.assign(new Error("Only the cashier can submit their open shift"), { status: 409 });
        const totals = cashierShiftTotals(existing.openingFloat, existing.payments, input.countedCash);
        if (Math.abs(totals.variance || 0) >= 0.01 && (!input.varianceReason || input.varianceReason.length < 5)) throw Object.assign(new Error("A clear variance reason is required"), { status: 422 });
        const updated = await tx.cashierShift.update({ where: { id: existing.id }, data: { status: "SUBMITTED", expectedCash: new Prisma.Decimal(totals.expectedCash), countedCash: new Prisma.Decimal(input.countedCash), variance: new Prisma.Decimal(totals.variance || 0), varianceReason: input.varianceReason, submittedAt: new Date() }, include });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "CASHIER_SHIFT_SUBMITTED", entityType: "CashierShift", entityId: updated.id, reason: input.varianceReason, afterHash: `${totals.expectedCash}:${input.countedCash}:${totals.variance}` });
        return updated;
      }
      if (!user.permissions.includes("billing.approve_shift")) throw Object.assign(new Error("Independent shift approval permission is required"), { status: 403 });
      if (existing.status !== "SUBMITTED") throw Object.assign(new Error("Only a submitted shift can be approved"), { status: 409 });
      if (existing.cashierId === user.id) throw Object.assign(new Error("A different finance manager must approve this cashier shift"), { status: 409 });
      const updated = await tx.cashierShift.update({ where: { id: existing.id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() }, include });
      await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "CASHIER_SHIFT_APPROVED", entityType: "CashierShift", entityId: updated.id, reason: input.reason, afterHash: `${updated.expectedCash}:${updated.countedCash}:${updated.variance}` });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ shift: { ...shift, totals: cashierShiftTotals(shift.openingFloat, shift.payments) } });
  } catch (error) { return apiError(error); }
}
