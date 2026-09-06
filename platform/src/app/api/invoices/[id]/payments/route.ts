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
      const invoice = await tx.invoice.findFirst({ where: { id, visit: { facilityId: user.facilityId }, status: { not: "VOID" } }, include: { items: true, payments: { where: { status: "CONFIRMED" } }, claims: { where: { status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "PAID"] } } }, visit: { include: { orders: true, encounters: true, facility: true } } } });
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
      const { total, paid } = invoiceTotals(invoice.items, invoice.payments);
      const allocatedToClaims = invoice.claims.reduce((sum, claim) => sum + Number(claim.amount), 0);
      const patientBalance = Math.max(0, total - paid - allocatedToClaims);
      if (!paymentFitsBalance(input.amount, patientBalance)) throw Object.assign(new Error(`Payment exceeds the patient-pay balance of ${invoice.currency} ${patientBalance.toFixed(2)}; insurer-allocated services cannot be collected from the patient`), { status: 422 });
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
      const submittedCover = invoice.claims.filter(claim => ["SUBMITTED", "APPROVED", "PAID"].includes(claim.status)).reduce((sum, claim) => sum + Number(claim.amount), 0);
      const paidClaimCover = invoice.claims.filter(claim => claim.status === "PAID").reduce((sum, claim) => sum + Number(claim.amount), 0);
      const settled = newPaid + allocatedToClaims >= total - 0.001;
      const fullyPaid = newPaid + paidClaimCover >= total - 0.001;
      await tx.invoice.update({ where: { id }, data: { status: fullyPaid ? "PAID" : settled ? "READY" : "PART_PAID" } });
      let visitCompleted = false;
      if (newPaid + submittedCover >= total - 0.001) {
        const outstandingOrders = invoice.visit.orders.some(order => ["DRAFT", "REQUESTED", "IN_PROGRESS"].includes(order.status));
        const signed = invoice.visit.encounters.some(encounter => encounter.status === "SIGNED");
        if (!outstandingOrders && signed) {
          await tx.queueEntry.updateMany({ where: { visitId: invoice.visitId, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
          await tx.visit.update({ where: { id: invoice.visitId }, data: { status: "COMPLETED", completedAt: new Date() } });
          visitCompleted = true;
        }
      }
      await appendAudit(tx, { userId: user.id, action: "PAYMENT_RECEIVED", entityType: "Invoice", entityId: id, afterHash: `${payment.reference}:${input.method}:${input.amount}:${settled}`, reason: input.externalReference });
      return { payment, total, paid: newPaid, balance: Math.max(0, total - newPaid - allocatedToClaims), settled, visitCompleted };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
