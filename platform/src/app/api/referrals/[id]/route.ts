import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { referralNextStatuses } from "@/lib/care-service-points";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const statusInput = z.object({
  status: z.enum(["SENT", "ACCEPTED", "ATTENDED", "RETURNED", "CLOSED"]),
  feedback: z.string().trim().max(3000).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("encounter.write");
    const { id } = await context.params;
    const input = statusInput.parse(await request.json());
    const referral = await db.$transaction(async (tx) => {
      const current = await tx.referral.findFirst({
        where: { id, facilityId: user.facilityId },
      });
      if (!current) throw Object.assign(new Error("Referral not found"), { status: 404 });
      if (!referralNextStatuses(current.status).includes(input.status))
        throw Object.assign(new Error(`Referral cannot move from ${current.status} to ${input.status}`), { status: 409 });
      if (input.status === "RETURNED" && (!input.feedback || input.feedback.length < 5))
        throw Object.assign(new Error("Record the receiving provider's feedback before returning the referral"), { status: 422 });
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
        },
        include: {
          patient: { select: { id: true, patientNumber: true, fullName: true, dateOfBirth: true, sexAtBirth: true } },
          visit: { select: { id: true, visitNumber: true, clinic: true, arrivedAt: true } },
          createdBy: { select: { displayName: true } },
          updatedBy: { select: { displayName: true } },
        },
      });
      await appendAudit(tx, {
        userId: user.id,
        action: "REFERRAL_STATUS_CHANGED",
        entityType: "Referral",
        entityId: current.id,
        beforeHash: current.status,
        afterHash: input.status,
      });
      return updated;
    });
    return NextResponse.json({ referral });
  } catch (error) {
    return apiError(error);
  }
}
