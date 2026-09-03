import { NextResponse } from "next/server";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { appointmentReminder } from "@/lib/reminders";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("visit.create");
    const { id } = await context.params;
    const appointment = await db.appointment.findFirst({
      where: { id, facilityId: user.facilityId, status: "SCHEDULED" },
      include: {
        facility: { select: { name: true } },
        patient: {
          include: {
            contacts: { where: { primary: true }, take: 1 },
            consents: { where: { type: "MESSAGING", granted: true, withdrawnAt: null }, take: 1 },
          },
        },
      },
    });
    if (!appointment) throw Object.assign(new Error("Scheduled appointment not found"), { status: 404 });
    if (!appointment.patient.consents.length)
      throw Object.assign(new Error("Patient has not consented to appointment messages"), { status: 422 });
    const contact = appointment.patient.contacts[0]?.value;
    if (!contact) throw Object.assign(new Error("Patient has no primary contact"), { status: 422 });

    const message = appointmentReminder({
      patientName: appointment.patient.fullName,
      facilityName: appointment.facility.name,
      clinic: appointment.clinic,
      scheduledAt: appointment.scheduledAt,
    });
    const preparedAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id }, data: { reminderPreparedAt: preparedAt } });
      await appendAudit(tx, { userId: user.id, action: "APPOINTMENT_REMINDER_PREPARED", entityType: "Appointment", entityId: id, afterHash: preparedAt.toISOString() });
    });
    return NextResponse.json({ contact, message, preparedAt });
  } catch (error) {
    return apiError(error);
  }
}
