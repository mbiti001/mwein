import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { operationalReference } from "@/lib/domain";
import { shaGatewayReadiness } from "@/lib/sha";
const schema = z.object({
  payer: z.enum(["SHA", "PRIVATE_INSURER", "EMPLOYER"]),
  memberNumber: z.string().trim().min(2).max(100),
  amount: z.coerce.number().positive().max(100000000),
  notes: z.string().trim().max(1000).optional(),
  submit: z.boolean().default(false),
});
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("claims.write");
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id,
          visit: { facilityId: user.facilityId },
          status: { not: "VOID" },
        },
        include: {
          items: true,
          payments: { where: { status: "CONFIRMED" } },
          claims: {
            where: { status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] } },
          },
          visit: { include: { facility: true, patient: { include: { identifiers: true } }, encounters: { include: { diagnoses: true } }, orders: true } },
        },
      });
      if (!invoice)
        throw Object.assign(new Error("Invoice not found"), { status: 404 });
      if (input.payer === "SHA") {
        const shaNumber = invoice.visit.patient.identifiers.find(identifier => identifier.type === "SHA")?.value;
        if (!shaNumber) throw Object.assign(new Error("Record and verify the patient SHA number before preparing this claim"), { status: 422 });
        if (shaNumber.trim().toUpperCase() !== input.memberNumber.trim().toUpperCase()) throw Object.assign(new Error("The claim member number does not match the patient SHA number"), { status: 422 });
        const signed = invoice.visit.encounters.find(encounter => encounter.status === "SIGNED");
        if (!signed) throw Object.assign(new Error("Sign the clinical encounter before preparing an SHA claim"), { status: 409 });
        if (!signed.diagnoses.some(diagnosis => diagnosis.codingSystem === "ICD-11 MMS" && diagnosis.code)) throw Object.assign(new Error("A coded ICD-11 diagnosis is required for an SHA claim"), { status: 422 });
        if (invoice.visit.orders.some(order => !["COMPLETED", "CANCELLED"].includes(order.status))) throw Object.assign(new Error("Complete or cancel all clinical orders before preparing an SHA claim"), { status: 409 });
        if (input.submit && !shaGatewayReadiness().ready) throw Object.assign(new Error("SHA gateway is not configured. Save the claim as a draft; do not mark it submitted."), { status: 503 });
      }
      const total = invoice.items.reduce(
          (s, i) => s + Number(i.quantity) * Number(i.unitPrice),
          0,
        ),
        paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0),
        claimed = invoice.claims.reduce((s, c) => s + Number(c.amount), 0),
        available = Math.max(0, total - paid - claimed);
      if (input.amount > available + 0.001)
        throw Object.assign(
          new Error(
            `Claim exceeds unallocated balance of ${invoice.currency} ${available.toFixed(2)}`,
          ),
          { status: 422 },
        );
      const year = new Date().getFullYear();
      const seq = await tx.referenceSequence.upsert({
        where: {
          facilityId_kind_year: {
            facilityId: user.facilityId,
            kind: "CLAIM",
            year,
          },
        },
        update: { nextValue: { increment: 1 } },
        create: {
          facilityId: user.facilityId,
          kind: "CLAIM",
          year,
          nextValue: 2,
        },
      });
      const claim = await tx.claim.create({
        data: {
          invoiceId: id,
          createdById: user.id,
          payer: input.payer,
          memberNumber: input.memberNumber,
          claimNumber: operationalReference(
            invoice.visit.facility.code,
            "CLM",
            year,
            seq.nextValue - 1n,
          ),
          amount: new Prisma.Decimal(input.amount),
          notes: input.notes,
          status: input.submit ? "SUBMITTED" : "DRAFT",
          submittedAt: input.submit ? new Date() : undefined,
        },
      });
      await appendAudit(tx, {
        userId: user.id,
        action: input.submit ? "CLAIM_SUBMITTED" : "CLAIM_DRAFT_CREATED",
        entityType: "Claim",
        entityId: claim.id,
        afterHash: `${claim.claimNumber}:${claim.payer}:${claim.amount}`,
      });
      return claim;
    });
    return NextResponse.json({ claim: result }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
