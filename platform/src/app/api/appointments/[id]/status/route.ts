import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { appointmentCanBeBooked, appointmentClinics } from "@/lib/appointments";

const schema = z.union([
  z.object({ action: z.literal("STATUS").optional(), status: z.enum(["CANCELLED", "NO_SHOW"]) }),
  z.object({ action: z.literal("RESCHEDULE"), scheduledAt: z.iso.datetime({ offset: true }), clinic: z.enum(appointmentClinics).optional(), reason: z.string().trim().min(5).max(300) }),
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("visit.create");
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const existing = await db.appointment.findFirst({ where: { id, facilityId: user.facilityId } });
    if (!existing) throw Object.assign(new Error("Appointment not found"), { status: 404 });
    if (!["SCHEDULED", "NO_SHOW"].includes(existing.status))
      throw Object.assign(new Error("Only scheduled or missed appointments can be updated"), { status: 409 });
    const appointment = await db.$transaction(async (tx) => {
      if (input.action === "RESCHEDULE") {
        const scheduledAt = new Date(input.scheduledAt);
        if (!appointmentCanBeBooked(scheduledAt)) throw Object.assign(new Error("Choose a future time within the next 90 days"), { status: 422 });
        const updated = await tx.appointment.update({ where: { id }, data: { scheduledAt, clinic: input.clinic || existing.clinic, status: "SCHEDULED", reminderPreparedAt: null } });
        await appendAudit(tx, { userId: user.id, action: "APPOINTMENT_RESCHEDULED", entityType: "Appointment", entityId: id, reason: input.reason, beforeHash: `${existing.scheduledAt.toISOString()}:${existing.clinic}:${existing.status}`, afterHash: `${scheduledAt.toISOString()}:${input.clinic || existing.clinic}:SCHEDULED` });
        return updated;
      }
      if (existing.status !== "SCHEDULED") throw Object.assign(new Error("Only scheduled appointments can be cancelled or marked missed"), { status: 409 });
      const updated = await tx.appointment.update({ where: { id }, data: { status: input.status } });
      await appendAudit(tx, { userId: user.id, action: `APPOINTMENT_${input.status}`, entityType: "Appointment", entityId: id, beforeHash: existing.status, afterHash: input.status });
      return updated;
    });
    return NextResponse.json({ appointment });
  } catch (error) {
    return apiError(error);
  }
}
