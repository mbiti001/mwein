import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { canonicalLaboratoryCode } from "@/lib/laboratory";

const schema = z.object({
  action: z.enum(["SAVE_DRAFT", "VERIFY"]),
  reportText: z.string().trim().max(5000).optional(),
  criticalNotification: z
    .object({
      notifiedTo: z.string().trim().min(2).max(160),
      method: z.enum(["PHONE", "IN_PERSON", "SECURE_MESSAGE"]),
      notifiedAt: z.coerce.date(),
      readBack: z.literal(true),
      confirmation: z.string().trim().min(3).max(500),
      escalation: z.string().trim().max(500).optional(),
    })
    .optional(),
  items: z
    .array(
      z.object({
        analyte: z.string().trim().min(1).max(120),
        value: z.string().trim().min(1).max(120),
        unit: z.string().trim().max(50).optional(),
        referenceRange: z.string().trim().max(120).optional(),
        flag: z
          .enum(["N", "L", "H", "LL", "HH", "A", "C", "P", "R"])
          .optional(),
      }),
    )
    .min(1)
    .max(100),
});

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
        include: { laboratory: true, visit: { include: { patient: true } } },
      });
      if (!order?.laboratory)
        throw Object.assign(new Error("Laboratory order not found"), {
          status: 404,
        });
      if (order.visit.clinicallyClosedAt || ["COMPLETED", "CANCELLED"].includes(order.status))
        throw Object.assign(new Error("This result is already verified"), {
          status: 409,
        });
      if (order.laboratory.specimenStatus !== "ACCEPTED")
        throw Object.assign(
          new Error("An accepted specimen is required before result entry"),
          { status: 409 },
        );
      const verified = input.action === "VERIFY";
      const catalogue = await tx.catalogItem.findFirst({
        where: {
          facilityId: user.facilityId,
          category: "LABORATORY_TEST",
          code: canonicalLaboratoryCode(order.laboratory.testCode),
        },
        include: { referenceRanges: { where: { active: true } } },
      });
      const birth = order.visit.patient.dateOfBirth;
      const ageDays = birth
        ? Math.max(0, Math.floor((Date.now() - birth.getTime()) / 86400000))
        : order.visit.patient.estimatedAgeYears !== null
          ? order.visit.patient.estimatedAgeYears! * 365
          : null;
      const resultItems = input.items.map((item) => {
        const range = catalogue?.referenceRanges.find(
          (value) =>
            value.analyte.toLowerCase() === item.analyte.toLowerCase() &&
            (value.sexAtBirth === "ANY" ||
              value.sexAtBirth === order.visit.patient.sexAtBirth) &&
            (ageDays === null ||
              ((value.minAgeDays === null || ageDays >= value.minAgeDays) &&
                (value.maxAgeDays === null || ageDays <= value.maxAgeDays))),
        );
        const numericValue = Number(item.value);
        const numeric = Number.isFinite(numericValue);
        const lower =
          range?.lowerLimit == null ? null : Number(range.lowerLimit);
        const upper =
          range?.upperLimit == null ? null : Number(range.upperLimit);
        const criticalLow =
          range?.criticalLow == null ? null : Number(range.criticalLow);
        const criticalHigh =
          range?.criticalHigh == null ? null : Number(range.criticalHigh);
        const critical =
          numeric &&
          ((criticalLow !== null && numericValue <= criticalLow) ||
            (criticalHigh !== null && numericValue >= criticalHigh));
        const qualitative = range?.qualitativeValues?.split("|").map(value => value.trim()) || [];
        if (qualitative.length && !qualitative.some(value => value.toLowerCase() === item.value.toLowerCase()))
          throw Object.assign(new Error(`${item.analyte} must use an approved qualitative result`), { status: 422 });
        const flag = critical
          ? criticalLow !== null && numericValue <= criticalLow ? "LL" : "HH"
          : numeric && lower !== null && numericValue < lower
            ? "L"
            : numeric && upper !== null && numericValue > upper
              ? "H"
              : range
                ? qualitative.length && item.value.toLowerCase() !== qualitative[0].toLowerCase() ? "A" : "N"
                : item.flag;
        const referenceRange = range
          ? range.qualitativeValues ||
            [lower, upper].filter((value) => value !== null).join(" – ")
          : item.referenceRange;
        return {
          ...item,
          componentCode: range?.componentCode,
          loincCode: range?.loincCode,
          numericValue: numeric ? numericValue : undefined,
          unit: range?.unit || item.unit,
          referenceRange,
          referenceRangeId: range?.id,
          flag,
          critical,
        };
      });
      const hasCritical = resultItems.some((item) => item.critical);
      if (verified && hasCritical && !input.criticalNotification)
        throw Object.assign(
          new Error(
            "Document immediate clinician notification before verifying a critical result",
          ),
          { status: 422 },
        );
      const laboratoryResult = await tx.laboratoryResult.upsert({
        where: { laboratoryOrderId: order.laboratory.id },
        update: {
          status: verified ? "VERIFIED" : "DRAFT",
          reportText: input.reportText,
          recordedById: user.id,
          verifiedById: verified ? user.id : null,
          verifiedAt: verified ? new Date() : null,
          criticalResult: hasCritical,
          criticalNotifiedTo: input.criticalNotification?.notifiedTo,
          criticalNotificationMethod: input.criticalNotification?.method,
          criticalNotifiedAt: input.criticalNotification?.notifiedAt,
          criticalReadBack: input.criticalNotification?.readBack || false,
          criticalConfirmation: input.criticalNotification?.confirmation,
          criticalEscalation: input.criticalNotification?.escalation,
          analyserCode: catalogue?.method,
          method: catalogue?.method,
          items: { deleteMany: {}, create: resultItems },
        },
        create: {
          laboratoryOrderId: order.laboratory.id,
          status: verified ? "VERIFIED" : "DRAFT",
          reportText: input.reportText,
          recordedById: user.id,
          verifiedById: verified ? user.id : null,
          verifiedAt: verified ? new Date() : null,
          criticalResult: hasCritical,
          criticalNotifiedTo: input.criticalNotification?.notifiedTo,
          criticalNotificationMethod: input.criticalNotification?.method,
          criticalNotifiedAt: input.criticalNotification?.notifiedAt,
          criticalReadBack: input.criticalNotification?.readBack || false,
          criticalConfirmation: input.criticalNotification?.confirmation,
          criticalEscalation: input.criticalNotification?.escalation,
          analyserCode: catalogue?.method,
          method: catalogue?.method,
          items: { create: resultItems },
        },
        include: { items: true },
      });
      if (verified) {
        await tx.clinicalOrder.update({
          where: { id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        const remainingLaboratory = await tx.clinicalOrder.count({
          where: { visitId: order.visitId, type: "LABORATORY", status: { in: ["REQUESTED", "IN_PROGRESS"] } },
        });
        if (remainingLaboratory === 0) await tx.queueEntry.updateMany({
          where: { visitId: order.visitId, servicePoint: "LABORATORY", status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        const remainingDiagnostics = await tx.clinicalOrder.count({
          where: {
            visitId: order.visitId,
            type: { in: ["LABORATORY", "IMAGING"] },
            status: { in: ["REQUESTED", "IN_PROGRESS"] },
          },
        });
        if (remainingDiagnostics === 0) {
          await tx.queueEntry.create({
            data: {
              visitId: order.visitId,
              servicePoint: "CONSULTATION",
              priority: order.visit.priority,
            },
          });
          await tx.visit.update({
            where: { id: order.visitId },
            data: { status: "AWAITING_CLINICIAN" },
          });
        }
      } else if (order.status === "REQUESTED")
        await tx.clinicalOrder.update({
          where: { id },
          data: { status: "IN_PROGRESS" },
        });
      await appendAudit(tx, {
        userId: user.id,
        action: verified ? "LAB_RESULT_VERIFIED" : "LAB_RESULT_DRAFT_SAVED",
        entityType: "LaboratoryResult",
        entityId: laboratoryResult.id,
      });
      return { laboratoryResult, verified };
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
