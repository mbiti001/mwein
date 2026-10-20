import { Prisma } from "@prisma/client";
import { isWaitingOverdue } from "@/lib/service-points";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { recordClinicalAccess } from "@/lib/clinical-access";
import {
  SHA_CANCELLATION_POLICY_VERSION,
  isEmergencyCancellationVisit,
  visitCancellationBlockers,
  visitCancellationReasonLabel,
  visitCancellationReasonSchema,
  visitCancellationSchema,
  type VisitCancellationPreview,
} from "@/lib/visit-cancellation";

const cancellationInclude = {
  cancellation: { select: { id: true } },
  patient: { select: { id: true, fullName: true, patientNumber: true } },
  encounters: { select: { status: true } },
  clinicDocuments: { select: { status: true, kind: true } },
  orders: { select: { id: true, status: true } },
  queues: {
    where: { status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
    select: { status: true, enteredAt: true, servicePoint: true },
    orderBy: { enteredAt: "asc" },
  },
  invoice: {
    include: {
      payments: { select: { status: true } },
      claims: { select: { id: true, status: true } },
    },
  },
} satisfies Prisma.VisitInclude;

async function cancellationState(client: Pick<Prisma.TransactionClient, "visit" | "servicePointControl">, id: string, facilityId: string) {
  const visit = await client.visit.findFirst({ where: { id, facilityId }, include: cancellationInclude });
  if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
  const waitingQueue = visit.queues.find(queue => ["WAITING", "CALLED"].includes(queue.status));
  const control = waitingQueue ? await client.servicePointControl.findUnique({
    where: { facilityId_servicePoint: { facilityId, servicePoint: waitingQueue.servicePoint } },
  }) : null;
  const overdueEligible = Boolean(waitingQueue && isWaitingOverdue(
    visit.priority,
    Math.floor((Date.now() - waitingQueue.enteredAt.getTime()) / 60000),
    control?.targetMinutes ?? 30,
  ));
  return { visit, overdueEligible };
}

function cancellationBlockers(state: Awaited<ReturnType<typeof cancellationState>>, reasonCode: string) {
  const blockers = visitCancellationBlockers(state.visit, reasonCode);
  if (state.visit.cancellation && state.visit.status !== "CANCELLED") blockers.push("This visit is already cancelled");
  if (reasonCode === "OVERDUE_UNPROCESSED" && !state.overdueEligible)
    blockers.push("This visit is not overdue in a waiting queue");
  return blockers;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("visit.cancel");
    const reasonCode = visitCancellationReasonSchema.parse(new URL(request.url).searchParams.get("reasonCode") ?? "PATIENT_REQUEST");
    const { id } = await context.params;
    const state = await cancellationState(db, id, user.facilityId);
    const { visit, overdueEligible } = state;
    const blockers = cancellationBlockers(state, reasonCode);
    const preview: VisitCancellationPreview = {
      visitId: visit.id,
      visitNumber: visit.visitNumber,
      patient: visit.patient,
      status: visit.status,
      canCancel: blockers.length === 0,
      blockers,
      overdueEligible,
      emergencyCare: isEmergencyCancellationVisit(visit),
      impact: {
        activeQueues: visit.queues.length,
        pendingOrders: visit.orders.filter(order => ["DRAFT", "REQUESTED"].includes(order.status)).length,
        draftClaims: visit.invoice?.claims.filter(claim => claim.status === "DRAFT").length || 0,
        voidInvoice: Boolean(visit.invoice && visit.invoice.status !== "VOID"),
        cancelAppointment: Boolean(visit.appointmentId),
      },
    };
    await recordClinicalAccess(user, "VISIT_CANCELLATION_REVIEW", [{ type: "Visit", id }]);
    return privateJson(preview);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("visit.cancel");
    const input = visitCancellationSchema.parse(await request.json());
    const { id } = await context.params;
    const result = await db.$transaction(async (tx) => {
      // The preview is advisory. Re-read every safeguard inside the write transaction.
      const state = await cancellationState(tx, id, user.facilityId);
      const { visit } = state;
      const blockers = cancellationBlockers(state, input.reasonCode);
      if (blockers.length) throw Object.assign(new Error(blockers.join(". ")), { status: 409, details: { blockers } });

      const cancelledAt = new Date();
      await tx.queueEntry.updateMany({
        where: { visitId: visit.id, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
        data: { status: "CANCELLED", completedAt: cancelledAt },
      });
      await tx.clinicalOrder.updateMany({
        where: { visitId: visit.id, status: { in: ["DRAFT", "REQUESTED"] } },
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
        await tx.appointment.updateMany({ where: { id: visit.appointmentId, facilityId: user.facilityId }, data: { status: "CANCELLED" } });

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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return privateJson(result);
  } catch (error) {
    return apiError(error);
  }
}
