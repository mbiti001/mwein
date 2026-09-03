import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { operationalReference } from "@/lib/domain";
import { invoiceTotals, paymentFitsBalance } from "@/lib/billing";

const schema = z.object({
  method: z.enum(["CASH", "MPESA", "CARD", "BANK"]),
  amount: z.coerce.number().positive().max(100000000),
  externalReference: z.string().trim().max(120).optional(),
}).superRefine((value, context) => {
  if (["MPESA", "CARD", "BANK"].includes(value.method) && !value.externalReference)
    context.addIssue({ code: "custom", path: ["externalReference"], message: "A transaction, approval or account reference is required" });
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("billing.write");
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const result = await db.$transaction(async tx => {
      const invoice = await tx.invoice.findFirst({ where: { id, visit: { facilityId: user.facilityId }, status: { not: "VOID" } }, include: { items: true, payments: { where: { status: "CONFIRMED" } }, visit: { include: { orders: true, encounters: true, facility: true } } } });
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
      const { total, paid, balance } = invoiceTotals(invoice.items, invoice.payments);
      if (!paymentFitsBalance(input.amount, balance)) throw Object.assign(new Error(`Payment exceeds the outstanding balance of ${invoice.currency} ${balance.toFixed(2)}`), { status: 422 });
      const year = new Date().getFullYear();
      const sequence = await tx.referenceSequence.upsert({
        where: { facilityId_kind_year: { facilityId: user.facilityId, kind: "RECEIPT", year } },
        update: { nextValue: { increment: 1 } }, create: { facilityId: user.facilityId, kind: "RECEIPT", year, nextValue: 2 },
      });
      const receiptNumber = operationalReference(invoice.visit.facility.code, "RCT", year, sequence.nextValue - 1n);
      const payment = await tx.payment.create({ data: {
        invoiceId: id, reference: `${receiptNumber}-PAY`, method: input.method,
        amount: new Prisma.Decimal(input.amount), externalReference: input.externalReference,
        receipt: { create: { receiptNumber } },
      }, include: { receipt: true } });
      const newPaid = paid + input.amount;
      const settled = newPaid >= total - 0.001;
      await tx.invoice.update({ where: { id }, data: { status: settled ? "PAID" : "PART_PAID" } });
      let visitCompleted = false;
      if (settled) {
        const outstandingOrders = invoice.visit.orders.some(order => ["DRAFT", "REQUESTED", "IN_PROGRESS"].includes(order.status));
        const signed = invoice.visit.encounters.some(encounter => encounter.status === "SIGNED");
        if (!outstandingOrders && signed) {
          await tx.queueEntry.updateMany({ where: { visitId: invoice.visitId, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
          await tx.visit.update({ where: { id: invoice.visitId }, data: { status: "COMPLETED", completedAt: new Date() } });
          visitCompleted = true;
        }
      }
      await appendAudit(tx, { userId: user.id, action: "PAYMENT_RECEIVED", entityType: "Invoice", entityId: id, afterHash: `${payment.reference}:${input.method}:${input.amount}:${settled}`, reason: input.externalReference });
      return { payment, total, paid: newPaid, balance: Math.max(0, total - newPaid), settled, visitCompleted };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
