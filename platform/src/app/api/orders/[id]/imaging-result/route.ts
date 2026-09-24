import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
const schema = z
  .object({
    action: z.enum(["SAVE_DRAFT", "VERIFY", "CANCEL"]),
    technique: z.string().trim().max(2000).optional(),
    findings: z.string().trim().max(10000).optional(),
    conclusion: z.string().trim().max(5000).optional(),
    recommendations: z.string().trim().max(3000).optional(),
    performedAt: z.coerce.date().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .superRefine((v, c) => {
    if (v.action !== "CANCEL" && (!v.findings || !v.conclusion)) {
      c.addIssue({
        code: "custom",
        path: ["findings"],
        message: "Findings and conclusion are required",
      });
    }
    if (v.action === "CANCEL" && !v.reason)
      c.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Cancellation reason is required",
      });
  });
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("imaging.write");
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const order = await tx.clinicalOrder.findFirst({
        where: { id, type: "IMAGING", visit: { facilityId: user.facilityId } },
        include: { imaging: true, visit: true },
      });
      if (!order?.imaging)
        throw Object.assign(new Error("Imaging order not found"), {
          status: 404,
        });
      if (order.visit.clinicallyClosedAt || ["COMPLETED", "CANCELLED"].includes(order.status))
        throw Object.assign(new Error("This imaging order is already closed"), {
          status: 409,
        });
      if (input.action === "CANCEL") {
        await tx.clinicalOrder.update({
          where: { id },
          data: { status: "CANCELLED", completedAt: new Date() },
        });
        await tx.invoiceItem.updateMany({ where: { orderId: id }, data: { quantity: 0, description: `${order.displayName} — cancelled` } });
        await appendAudit(tx, {
          userId: user.id,
          action: "IMAGING_CANCELLED",
          entityType: "ClinicalOrder",
          entityId: id,
          reason: input.reason,
        });
        return { status: "CANCELLED" };
      }
      const verified = input.action === "VERIFY";
      const report = await tx.imagingResult.upsert({
        where: { imagingOrderId: order.imaging.id },
        update: {
          status: verified ? "VERIFIED" : "DRAFT",
          technique: input.technique,
          findings: input.findings!,
          conclusion: input.conclusion!,
          recommendations: input.recommendations,
          performedAt: input.performedAt || new Date(),
          performedById: user.id,
          verifiedAt: verified ? new Date() : null,
          verifiedById: verified ? user.id : null,
        },
        create: {
          imagingOrderId: order.imaging.id,
          status: verified ? "VERIFIED" : "DRAFT",
          technique: input.technique,
          findings: input.findings!,
          conclusion: input.conclusion!,
          recommendations: input.recommendations,
          performedAt: input.performedAt || new Date(),
          performedById: user.id,
          verifiedAt: verified ? new Date() : undefined,
          verifiedById: verified ? user.id : undefined,
        },
      });
      await tx.clinicalOrder.update({
        where: { id },
        data: {
          status: verified ? "COMPLETED" : "IN_PROGRESS",
          completedAt: verified ? new Date() : null,
        },
      });
      if (verified) {
        const remainingImaging = await tx.clinicalOrder.count({
          where: { visitId: order.visitId, type: "IMAGING", status: { in: ["REQUESTED", "IN_PROGRESS"] } },
        });
        if (remainingImaging === 0) await tx.queueEntry.updateMany({
          where: { visitId: order.visitId, servicePoint: "IMAGING", status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        const remainingDiagnostics = await tx.clinicalOrder.count({
          where: {
            visitId: order.visitId,
            type: { in: ["LABORATORY", "IMAGING"] },
            status: { in: ["REQUESTED", "IN_PROGRESS"] },
          },
        });
        if (!remainingDiagnostics) {
          await tx.visit.update({
            where: { id: order.visitId },
            data: { status: "AWAITING_CLINICIAN" },
          });
          await tx.queueEntry.create({
            data: {
              visitId: order.visitId,
              servicePoint: "CONSULTATION",
              priority: order.visit.priority,
            },
          });
        }
      }
      await appendAudit(tx, {
        userId: user.id,
        action: verified
          ? "IMAGING_REPORT_VERIFIED"
          : "IMAGING_REPORT_DRAFT_SAVED",
        entityType: "ImagingResult",
        entityId: report.id,
        afterHash: `${report.status}:${report.conclusion}`,
      });
      return { report };
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
