import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import {
  SHA_CANCELLATION_POLICY_VERSION,
  visitCancellationBlockers,
  visitCancellationReasonLabel,
  visitCancellationSchema,
} from "@/lib/visit-cancellation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("visit.cancel");
    const input = visitCancellationSchema.parse(await request.json());
    const { id } = await context.params;
    const result = await db.$transaction(async (tx) => {
      const visit = await tx.visit.findFirst({
        where: { id, facilityId: user.facilityId },
        include: {
          cancellation: true,
          encounters: { select: { status: true } },
          orders: { select: { id: true, status: true, displayName: true } },
          invoice: {
            include: {
              payments: { select: { status: true } },
              claims: { select: { id: true, status: true } },
            },
          },
        },
      });
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      if (visit.cancellation) throw Object.assign(new Error("This visit is already cancelled"), { status: 409 });
      const blockers = visitCancellationBlockers(visit, input.reasonCode);
      if (blockers.length) throw Object.assign(new Error(blockers.join(". ")), { status: 409, details: { blockers } });

      const cancelledAt = new Date();
      await tx.queueEntry.updateMany({
        where: { visitId: visit.id, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
        data: { status: "CANCELLED", completedAt: cancelledAt },
      });
      await tx.clinicalOrder.updateMany({
        where: { visitId: visit.id, status: { in: ["DRAFT", "REQUESTED", "IN_PROGRESS"] } },
        data: { status: "CANCELLED", completedAt: cancelledAt },
      });
      if (visit.invoice) {
        await tx.claim.updateMany({
          where: { invoiceId: visit.invoice.id, status: "DRAFT" },
          data: { status: "CANCELLED" },
        });
        await tx.invoice.update({ where: { id: visit.invoice.id }, data: { status: "VOID" } });
      }
      if (visit.appointmentId)
        await tx.appointment.updateMany({ where: { id: visit.appointmentId }, data: { status: "CANCELLED" } });

      const cancellation = await tx.visitCancellation.create({
        data: {
          facilityId: user.facilityId,
          visitId: visit.id,
          reasonCode: input.reasonCode,
          details: input.details,
          shaOutcome: input.shaOutcome,
          shaEligibilityReference: input.shaEligibilityReference,
          policyVersion: input.reasonCode === "SHA_BENEFIT_OR_ELIGIBILITY" ? SHA_CANCELLATION_POLICY_VERSION : undefined,
          cancelledById: user.id,
          cancelledAt,
        },
      });
      const updated = await tx.visit.update({
        where: { id: visit.id },
        data: { status: "CANCELLED" },
      });
      await appendAudit(tx, {
        facilityId: user.facilityId,
        userId: user.id,
        sessionId: user.sessionId,
        action: "VISIT_CANCELLED",
        entityType: "Visit",
        entityId: visit.id,
        reason: visitCancellationReasonLabel(input.reasonCode),
        beforeHash: visit.status,
        afterHash: `CANCELLED:${input.reasonCode}:${input.shaOutcome || "NOT_SHA"}`,
      });
      return { visit: updated, cancellation };
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
