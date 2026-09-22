import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { isIsoCalendarDate, summarizeCashierActivity, summarizeDispensing, summarizeOperations, summarizeQueuePerformance, summarizeReferralFlow } from "@/lib/reporting";

const dateText = z.string().refine(isIsoCalendarDate, "A valid date is required");
const querySchema = z
  .object({ from: dateText, to: dateText })
  .refine((value) => value.from <= value.to, {
    message: "The start date must not follow the end date",
  });

export async function GET(request: Request) {
  try {
    const user = await requirePermission("billing.read");
    const url = new URL(request.url);
    const input = querySchema.parse({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    const from = new Date(`${input.from}T00:00:00+03:00`);
    const through = new Date(`${input.to}T00:00:00+03:00`);
    through.setUTCDate(through.getUTCDate() + 1);
    if (through.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000)
      throw Object.assign(new Error("Reports are limited to 31 days"), { status: 422 });

    const [visits, queueEntries, referrals, dispensations, payments, inventory] = await Promise.all([db.visit.findMany({
      where: {
        facilityId: user.facilityId,
        arrivedAt: { gte: from, lt: through },
      },
      select: {
        priority: true,
        status: true,
        invoice: {
          select: {
            status: true,
            items: { select: { quantity: true, unitPrice: true } },
            payments: { select: { amount: true, status: true } },
            claims: {
              select: {
                id: true,
                claimNumber: true,
                payer: true,
                amount: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    }), db.queueEntry.findMany({
      where: { visit: { facilityId: user.facilityId }, enteredAt: { gte: from, lt: through } },
      select: { servicePoint: true, status: true, enteredAt: true, completedAt: true },
    }), db.referral.findMany({
      where: { facilityId: user.facilityId, createdAt: { gte: from, lt: through } }, select: { status: true },
    }), db.dispensation.findMany({
      where: { prescription: { order: { visit: { facilityId: user.facilityId } } }, dispensedAt: { gte: from, lt: through } },
      select: { quantity: true, catalogItem: { select: { code: true, name: true } }, items: { select: { quantity: true, unitPrice: true, unitCost: true } } },
    }), db.payment.findMany({
      where: { invoice: { visit: { facilityId: user.facilityId } }, receivedAt: { gte: from, lt: through } },
      select: { amount: true, status: true, method: true, receivedBy: { select: { displayName: true } } },
    }), db.catalogItem.findMany({
      where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true },
      select: { id: true, code: true, name: true, reorderLevel: true, inventoryBatches: { where: { active: true }, select: { quantityAvailable: true, expiryDate: true } } },
    })]);
    const inThirtyDays = new Date(Date.now() + 30 * 86400000);
    const inNinetyDays = new Date(Date.now() + 90 * 86400000);
    const stock = {
      lowStock: inventory.filter(item => item.reorderLevel != null && item.inventoryBatches.reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0) <= Number(item.reorderLevel)).map(item => ({ code: item.code, name: item.name })),
      expiring30Days: inventory.filter(item => item.inventoryBatches.some(batch => batch.expiryDate <= inThirtyDays && Number(batch.quantityAvailable) > 0)).length,
      expiring90Days: inventory.filter(item => item.inventoryBatches.some(batch => batch.expiryDate <= inNinetyDays && Number(batch.quantityAvailable) > 0)).length,
    };
    return NextResponse.json({
      range: input,
      generatedAt: new Date().toISOString(),
      summary: summarizeOperations(visits),
      departments: {
        queues: summarizeQueuePerformance(queueEntries),
        referrals: summarizeReferralFlow(referrals),
        pharmacy: { consumption: summarizeDispensing(dispensations).slice(0, 12), ...stock },
        cashiers: summarizeCashierActivity(payments),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
