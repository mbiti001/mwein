import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("COLLECT"), collectedAt: z.coerce.date() }),
  z.object({
    action: z.literal("RECEIVE"),
    receivedAt: z.coerce.date(),
    specimenCondition: z.enum([
      "ACCEPTABLE",
      "HAEMOLYSED",
      "LIPEMIC",
      "ICTERIC",
      "OTHER",
    ]),
  }),
  z.object({
    action: z.literal("REJECT"),
    reason: z.string().trim().min(3).max(1000),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("laboratory.write");
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const order = await tx.clinicalOrder.findFirst({
        where: {
          id,
          type: "LABORATORY",
          visit: { facilityId: user.facilityId },
        },
        include: { laboratory: true, visit: { include: { facility: true } } },
      });
      if (!order?.laboratory)
        throw Object.assign(new Error("Laboratory order not found"), {
          status: 404,
        });
      if (order.visit.clinicallyClosedAt || ["COMPLETED", "CANCELLED"].includes(order.status))
        throw Object.assign(
          new Error("A completed order cannot receive another specimen"),
          { status: 409 },
        );
      if (input.action === "COLLECT") {
        const year = new Date().getFullYear();
        const sequence = await tx.referenceSequence.upsert({
          where: {
            facilityId_kind_year: {
              facilityId: user.facilityId,
              kind: "LAB_ACCESSION",
              year,
            },
          },
          update: { nextValue: { increment: 1 } },
          create: {
            facilityId: user.facilityId,
            kind: "LAB_ACCESSION",
            year,
            nextValue: 2,
          },
        });
        const accessionNumber = `${order.visit.facility.code}-LAB-${year}-${(sequence.nextValue - 1n).toString().padStart(6, "0")}`;
        const laboratory = await tx.laboratoryOrder.update({
          where: { id: order.laboratory.id },
          data: {
            accessionNumber,
            collectedAt: input.collectedAt,
            collectedById: user.id,
            receivedAt: null,
            receivedById: null,
            specimenCondition: null,
            rejectionReason: null,
            specimenStatus: "COLLECTED",
          },
        });
        await tx.clinicalOrder.update({
          where: { id },
          data: { status: "IN_PROGRESS" },
        });
        await appendAudit(tx, {
          userId: user.id,
          action: "SPECIMEN_COLLECTED",
          entityType: "LaboratoryOrder",
          entityId: laboratory.id,
          afterHash: accessionNumber,
        });
        return laboratory;
      }
      if (
        !order.laboratory.collectedAt ||
        order.laboratory.specimenStatus !== "COLLECTED"
      )
        throw Object.assign(
          new Error("Record specimen collection before receipt"),
          { status: 409 },
        );
      if (input.action === "REJECT") {
        const laboratory = await tx.laboratoryOrder.update({
          where: { id: order.laboratory.id },
          data: {
            specimenStatus: "REJECTED",
            rejectionReason: input.reason,
            receivedAt: new Date(),
            receivedById: user.id,
          },
        });
        await tx.clinicalOrder.update({
          where: { id },
          data: { status: "REQUESTED" },
        });
        await appendAudit(tx, {
          userId: user.id,
          action: "SPECIMEN_REJECTED",
          entityType: "LaboratoryOrder",
          entityId: laboratory.id,
          reason: input.reason,
        });
        return laboratory;
      }
      if (input.receivedAt < order.laboratory.collectedAt)
        throw Object.assign(
          new Error("Receipt time cannot precede collection time"),
          { status: 422 },
        );
      const laboratory = await tx.laboratoryOrder.update({
        where: { id: order.laboratory.id },
        data: {
          receivedAt: input.receivedAt,
          receivedById: user.id,
          specimenCondition: input.specimenCondition,
          specimenStatus: "ACCEPTED",
        },
      });
      await appendAudit(tx, {
        userId: user.id,
        action: "SPECIMEN_ACCEPTED",
        entityType: "LaboratoryOrder",
        entityId: laboratory.id,
        afterHash: `${laboratory.accessionNumber}:${input.specimenCondition}`,
      });
      return laboratory;
    });
    return NextResponse.json({ laboratory: result });
  } catch (error) {
    return apiError(error);
  }
}
