import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const schema = z.object({ status: z.enum(["CANCELLED", "NO_SHOW"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("visit.create");
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const existing = await db.appointment.findFirst({ where: { id, facilityId: user.facilityId } });
    if (!existing) throw Object.assign(new Error("Appointment not found"), { status: 404 });
    if (existing.status !== "SCHEDULED")
      throw Object.assign(new Error("Only scheduled appointments can be updated"), { status: 409 });
    const appointment = await db.$transaction(async (tx) => {
      const updated = await tx.appointment.update({ where: { id }, data: { status: input.status } });
      await appendAudit(tx, { userId: user.id, action: `APPOINTMENT_${input.status}`, entityType: "Appointment", entityId: id, beforeHash: existing.status, afterHash: input.status });
      return updated;
    });
    return NextResponse.json({ appointment });
  } catch (error) {
    return apiError(error);
  }
}
