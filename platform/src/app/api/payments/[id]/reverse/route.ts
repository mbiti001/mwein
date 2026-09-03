import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("billing.reverse");
    const { id } = await context.params;
    const { reason } = z
      .object({ reason: z.string().trim().min(5).max(500) })
      .parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          id,
          status: "CONFIRMED",
          invoice: { visit: { facilityId: user.facilityId } },
        },
        include: {
          invoice: {
            include: {
              items: true,
              payments: { where: { status: "CONFIRMED" } },
            },
          },
        },
      });
      if (!payment)
        throw Object.assign(new Error("Confirmed payment not found"), {
          status: 404,
        });
      const remaining =
          payment.invoice.payments.reduce((s, p) => s + Number(p.amount), 0) -
          Number(payment.amount),
        total = payment.invoice.items.reduce(
          (s, i) => s + Number(i.quantity) * Number(i.unitPrice),
          0,
        );
      await tx.payment.update({
        where: { id },
        data: {
          status: "REVERSED",
          reversedAt: new Date(),
          reversalReason: reason,
          reversedById: user.id,
        },
      });
      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          status:
            remaining <= 0 ? "OPEN" : remaining < total ? "PART_PAID" : "PAID",
        },
      });
      await appendAudit(tx, {
        userId: user.id,
        action: "PAYMENT_REVERSED",
        entityType: "Payment",
        entityId: id,
        beforeHash: `CONFIRMED:${payment.amount}`,
        afterHash: "REVERSED",
        reason,
      });
      return { status: "REVERSED" };
    });
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
