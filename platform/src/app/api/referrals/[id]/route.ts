import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { referralNextStatuses } from "@/lib/care-service-points";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import {
  receivingAcknowledgementStatuses,
  referralStatusInput,
  serializeReferral,
} from "@/lib/referrals";

const referralInclude = {
  patient: { select: { id: true, patientNumber: true, fullName: true, dateOfBirth: true, sexAtBirth: true } },
  visit: { select: { id: true, visitNumber: true, clinic: true, arrivedAt: true } },
  createdBy: { select: { displayName: true } },
  updatedBy: { select: { displayName: true } },
  attachments: {
    include: { attachedBy: { select: { displayName: true } } },
    orderBy: { attachedAt: "asc" },
  },
  acknowledgements: {
    include: { recordedBy: { select: { displayName: true } } },
    orderBy: { acknowledgedAt: "asc" },
  },
} satisfies Prisma.ReferralInclude;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("encounter.write");
    const { id } = await context.params;
    const input = referralStatusInput.parse(await request.json());
    const referral = await db.$transaction(async (tx) => {
      const current = await tx.referral.findFirst({
        where: { id, facilityId: user.facilityId },
        include: {
          acknowledgements: {
            orderBy: { acknowledgedAt: "desc" },
            take: 1,
            select: { acknowledgedAt: true },
          },
        },
      });
      if (!current) throw Object.assign(new Error("Referral not found"), { status: 404 });
      if (!referralNextStatuses(current.status).includes(input.status))
        throw Object.assign(new Error(`Referral cannot move from ${current.status} to ${input.status}`), { status: 409 });
      if (input.status === "RETURNED" && (!input.feedback || input.feedback.length < 5))
        throw Object.assign(new Error("Record the receiving provider's feedback before returning the referral"), { status: 422 });
      const acknowledgedAt = input.acknowledgement?.acknowledgedAt
        ? new Date(input.acknowledgement.acknowledgedAt)
        : new Date();
      if (acknowledgedAt.getTime() > Date.now() + 5 * 60 * 1000)
        throw Object.assign(new Error("Acknowledgement time cannot be in the future"), { status: 422 });
      if (input.acknowledgement && current.sentAt && acknowledgedAt < current.sentAt)
        throw Object.assign(new Error("Acknowledgement time cannot be earlier than the referral send time"), { status: 422 });
      const previousAcknowledgementAt = current.acknowledgements?.[0]?.acknowledgedAt;
      if (input.acknowledgement && previousAcknowledgementAt && acknowledgedAt < previousAcknowledgementAt)
        throw Object.assign(new Error("Acknowledgement time cannot precede the previous receiving-provider event"), { status: 422 });
      const timestampField = {
        SENT: "sentAt",
        ACCEPTED: "acceptedAt",
        ATTENDED: "attendedAt",
        RETURNED: "returnedAt",
        CLOSED: "closedAt",
      }[input.status];
      const updated = await tx.referral.update({
        where: { id: current.id },
        data: {
          status: input.status,
          feedback: input.feedback || current.feedback,
          updatedById: user.id,
          [timestampField]: new Date(),
          acknowledgements: receivingAcknowledgementStatuses.includes(
            input.status as (typeof receivingAcknowledgementStatuses)[number],
          )
            ? {
                create: {
                  eventType: input.status,
                  referralStatus: input.status,
                  providerName: input.acknowledgement!.providerName,
                  providerRole: input.acknowledgement!.providerRole,
                  registrationNumber: input.acknowledgement!.registrationNumber,
                  note: input.acknowledgement!.note,
                  acknowledgedAt,
                  recordedById: user.id,
                },
              }
            : undefined,
        },
        include: referralInclude,
      });
      await appendAudit(tx, {
        userId: user.id,
        action: "REFERRAL_STATUS_CHANGED",
        entityType: "Referral",
        entityId: current.id,
        beforeHash: current.status,
        afterHash: input.status,
      });
      if (input.acknowledgement) {
        const acknowledgement = updated.acknowledgements.at(-1)!;
        await appendAudit(tx, {
          userId: user.id,
          action: "REFERRAL_ACKNOWLEDGED",
          entityType: "ReferralAcknowledgement",
          entityId: acknowledgement.id,
          afterHash: `${acknowledgement.eventType}:${acknowledgement.acknowledgedAt.toISOString()}`,
        });
      }
      return serializeReferral(updated);
    });
    return NextResponse.json({ referral });
  } catch (error) {
    return apiError(error);
  }
}
