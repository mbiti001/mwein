import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { operationalReference } from "@/lib/domain";
import { assessShaRoute, shaFunds, shaGatewayReadiness } from "@/lib/sha";
const schema = z.object({
  payer: z.enum(["SHA", "PRIVATE_INSURER", "EMPLOYER"]),
  memberNumber: z.string().trim().min(2).max(100),
  coveredItemIds: z.array(z.uuid()).min(1).max(100),
  notes: z.string().trim().max(1000).optional(),
  submit: z.boolean().default(false),
  fundCode: z.enum(shaFunds).optional(),
  eligibilityVerified: z.boolean().optional(),
  facilityServiceApproved: z.boolean().optional(),
  authorizationRequired: z.boolean().optional(),
  authorizationReference: z.string().trim().max(120).optional(),
  serviceDate: z.coerce.date().optional(),
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
            where: { status: { in: ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "REDUCED", "UNDER_REVIEW", "WITHHELD"] } },
            include: { lines: true },
          },
          visit: { include: { facility: true, patient: { include: { identifiers: true } }, encounters: { include: { diagnoses: true } }, orders: true } },
        },
      });
      if (!invoice)
        throw Object.assign(new Error("Invoice not found"), { status: 404 });
      if (input.payer === "SHA") {
        if (!input.fundCode || input.eligibilityVerified === undefined || input.facilityServiceApproved === undefined || !input.serviceDate) {
          throw Object.assign(new Error("Select the SHA Fund and complete the eligibility, facility-service and service-date checks"), { status: 422 });
        }
        const routing = assessShaRoute({
          fund: input.fundCode,
          eligibilityVerified: input.eligibilityVerified,
          facilityServiceApproved: input.facilityServiceApproved,
          requiresAuthorization: Boolean(input.authorizationRequired),
          authorizationReference: input.authorizationReference,
          serviceDate: input.serviceDate,
        });
        if (input.submit && !routing.ready) throw Object.assign(new Error(routing.blockers.join("; ")), { status: 422 });
        const shaNumber = invoice.visit.patient.identifiers.find(identifier => identifier.type === "SHA")?.value;
        if (!shaNumber) throw Object.assign(new Error("Record and verify the patient SHA number before preparing this claim"), { status: 422 });
        if (shaNumber.trim().toUpperCase() !== input.memberNumber.trim().toUpperCase()) throw Object.assign(new Error("The claim member number does not match the patient SHA number"), { status: 422 });
        const signed = invoice.visit.encounters.find(encounter => encounter.status === "SIGNED");
        if (!signed) throw Object.assign(new Error("Sign the clinical encounter before preparing an SHA claim"), { status: 409 });
        if (!signed.diagnoses.some(diagnosis => diagnosis.codingSystem === "ICD-11 MMS" && diagnosis.code)) throw Object.assign(new Error("A coded ICD-11 diagnosis is required for an SHA claim"), { status: 422 });
        if (invoice.visit.orders.some(order => !["COMPLETED", "CANCELLED"].includes(order.status))) throw Object.assign(new Error("Complete or cancel all clinical orders before preparing an SHA claim"), { status: 409 });
        if (input.submit && !shaGatewayReadiness().ready) throw Object.assign(new Error("SHA gateway is not configured. Save the claim as a draft; do not mark it submitted."), { status: 503 });
      }
      const selected = invoice.items.filter(item => input.coveredItemIds.includes(item.id));
      if (selected.length !== new Set(input.coveredItemIds).size) throw Object.assign(new Error("One or more selected claim items do not belong to this invoice"), { status: 422 });
      const alreadyAllocated = new Set(invoice.claims.flatMap(claim => claim.lines.map(line => line.invoiceItemId)));
      const duplicate = selected.find(item => alreadyAllocated.has(item.id));
      if (duplicate) throw Object.assign(new Error(`${duplicate.description} is already allocated to an active claim`), { status: 409 });
      const amount = selected.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
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
          amount: new Prisma.Decimal(amount),
          notes: input.notes,
          fundCode: input.payer === "SHA" ? input.fundCode : undefined,
          eligibilityVerifiedAt: input.payer === "SHA" && input.eligibilityVerified ? new Date() : undefined,
          facilityServiceApproved: input.payer === "SHA" ? input.facilityServiceApproved : undefined,
          authorizationRequired: input.payer === "SHA" ? Boolean(input.authorizationRequired) : false,
          authorizationReference: input.payer === "SHA" ? input.authorizationReference : undefined,
          serviceDate: input.payer === "SHA" ? input.serviceDate : undefined,
          submissionDeadline: input.payer === "SHA" && input.serviceDate ? assessShaRoute({ fund: input.fundCode!, eligibilityVerified: Boolean(input.eligibilityVerified), facilityServiceApproved: Boolean(input.facilityServiceApproved), requiresAuthorization: Boolean(input.authorizationRequired), authorizationReference: input.authorizationReference, serviceDate: input.serviceDate }).deadline : undefined,
          status: input.submit ? "SUBMITTED" : "DRAFT",
          submittedAt: input.submit ? new Date() : undefined,
          lines: { create: selected.map(item => ({ invoiceItemId: item.id, amount: new Prisma.Decimal(Number(item.quantity) * Number(item.unitPrice)) })) },
        },
      });
      await appendAudit(tx, {
        userId: user.id,
        action: input.submit ? "CLAIM_SUBMITTED" : "CLAIM_DRAFT_CREATED",
        entityType: "Claim",
        entityId: claim.id,
        afterHash: `${claim.claimNumber}:${claim.payer}:${claim.amount}:${selected.map(item => item.id).join(",")}`,
      });
      const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const existingSubmitted = invoice.claims.filter(existing => ["SUBMITTED", "RETURNED", "APPROVED", "REDUCED", "UNDER_REVIEW", "WITHHELD", "PAID"].includes(existing.status)).reduce((sum, existing) => sum + Number(existing.amount), 0);
      const total = invoice.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
      const clinicallyComplete = invoice.visit.encounters.some(encounter => encounter.status === "SIGNED") && invoice.visit.orders.every(order => ["COMPLETED", "CANCELLED"].includes(order.status));
      const visitCompleted = input.submit && clinicallyComplete && paid + existingSubmitted + amount >= total - 0.001;
      if (visitCompleted) {
        const completedAt = new Date();
        await tx.queueEntry.updateMany({ where: { visitId: invoice.visitId, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt } });
        await tx.visit.update({ where: { id: invoice.visitId }, data: { status: "COMPLETED", completedAt } });
        await appendAudit(tx, { userId: user.id, action: "VISIT_COMPLETED_AFTER_CLAIM_SUBMISSION", entityType: "Visit", entityId: invoice.visitId, afterHash: claim.claimNumber });
      }
      return { claim, visitCompleted };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
