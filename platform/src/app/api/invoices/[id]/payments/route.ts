import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { operationalReference } from "@/lib/domain";
import { invoiceTotals, paymentFitsBalance } from "@/lib/billing";

const schema = z.object({
  idempotencyKey: z.uuid(),
  method: z.enum(["CASH", "MPESA", "CARD", "BANK"]),
  amount: z.coerce.number().positive().max(100000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use at most two decimal places"),
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
    const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const fingerprint = digest([id, input.method, input.amount, input.externalReference || ""]);
    // A non-cash reference is replay-protected within its invoice and method.
    // Cross-invoice allocation rules belong to the future provider contract.
    const externalKey = input.method !== "CASH" && input.externalReference ? digest([id, input.method, input.externalReference]) : null;
    const receive = () => db.$transaction(async tx => {
      const replay = await tx.paymentRequest.findUnique({ where: { facilityId_key: { facilityId: user.facilityId, key: input.idempotencyKey } } })
        ?? (externalKey ? await tx.paymentRequest.findUnique({ where: { facilityId_externalKey: { facilityId: user.facilityId, externalKey } } }) : null);
      if (replay) {
        if (replay.invoiceId !== id || replay.fingerprint !== fingerprint)
          throw Object.assign(new Error("This payment request or reference was already used with different details. Review the existing receipt."), { status: 409 });
        return { body: replay.response, replayed: true };
      }
      const invoice = await tx.invoice.findFirst({ where: { id, visit: { facilityId: user.facilityId }, status: { not: "VOID" } }, include: { items: true, payments: { where: { status: "CONFIRMED" } }, claims: { where: { status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "PAID"] } } }, visit: { include: { orders: true, encounters: true, facility: true } } } });
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
      if (input.method !== "CASH" && input.externalReference) {
        const existing = await tx.payment.findFirst({ where: { invoiceId: id, method: input.method, externalReference: input.externalReference } });
        if (existing) throw Object.assign(new Error("This transaction reference is already recorded on this invoice. Review its receipt before recording another payment."), { status: 409 });
      }
      const cashierShift = input.method === "CASH" ? await tx.cashierShift.findFirst({ where: { facilityId: user.facilityId, cashierId: user.id, status: "OPEN" } }) : null;
      if (input.method === "CASH" && !cashierShift) throw Object.assign(new Error("Open a cashier shift before receiving cash"), { status: 409 });
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
        amount: new Prisma.Decimal(input.amount), externalReference: input.externalReference, receivedById: user.id, cashierShiftId: cashierShift?.id,
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
        if (!outstandingOrders && signed && invoice.visit.clinicallyClosedAt && invoice.visit.status === "DISCHARGED") {
          await tx.queueEntry.updateMany({ where: { visitId: invoice.visitId, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
          await tx.visit.update({ where: { id: invoice.visitId }, data: { status: "COMPLETED", completedAt: new Date() } });
          visitCompleted = true;
        }
      }
      await appendAudit(tx, { userId: user.id, action: "PAYMENT_RECEIVED", entityType: "Invoice", entityId: id, afterHash: `${payment.reference}:${input.method}:${input.amount}:${settled}`, reason: input.externalReference });
      const body = JSON.parse(JSON.stringify({ payment, total, paid: newPaid, balance: Math.max(0, total - newPaid - allocatedToClaims), settled, visitCompleted })) as Prisma.InputJsonObject;
      await tx.paymentRequest.create({ data: { facilityId: user.facilityId, invoiceId: id, key: input.idempotencyKey, fingerprint, externalKey, response: body } });
      return { body, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    // Serializable conflicts and concurrent unique-key inserts are safe to retry:
    // the failed transaction rolls back both receipt and replay record.
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await receive();
        return privateJson(result.body, { status: result.replayed ? 200 : 201, headers: { "Idempotency-Replayed": String(result.replayed) } });
      } catch (error) {
        if (attempt >= 2 || !["P2034", "P2002"].includes((error as { code?: string }).code || "")) throw error;
      }
    }
  } catch (error) { return apiError(error); }
}
