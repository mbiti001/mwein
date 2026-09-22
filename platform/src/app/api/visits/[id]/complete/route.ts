import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { visitCompletionBlockers } from "@/lib/visit-completion";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("billing.write");
    const { id } = await context.params;
    const result = await db.$transaction(async tx => {
      const visit = await tx.visit.findFirst({
        where: { id, facilityId: user.facilityId },
        include: { encounters: true, orders: true, dispositionRecord: true, invoice: { include: { items: true, payments: true, claims: true } } },
      });
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      const blockers = visitCompletionBlockers(visit);
      if (blockers.length) throw Object.assign(new Error(blockers.join(". ")), { status: 409 });
      const completedAt = new Date();
      await tx.queueEntry.updateMany({ where: { visitId: id, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt } });
      const completed = await tx.visit.update({ where: { id }, data: { status: "COMPLETED", completedAt } });
      await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "VISIT_COMPLETED", entityType: "Visit", entityId: id, beforeHash: visit.status, afterHash: `${visit.dispositionRecord!.outcome}:${completedAt.toISOString()}` });
      return completed;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ visit: result });
  } catch (error) {
    return apiError(error);
  }
}
