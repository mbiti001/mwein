import { recordDisclosure } from "@/lib/disclosure-audit";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appointmentCanBeBooked, appointmentClinics, appointmentScopes, appointmentWindow } from "@/lib/appointments";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError, privateJson } from "@/lib/http";

const inputSchema = z.object({
  patientId: z.uuid(),
  scheduledAt: z.iso.datetime({ offset: true }),
  clinic: z.enum(appointmentClinics),
  notes: z.string().trim().max(300).optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requirePermission("visit.read");
    const now = new Date();
    const params = new URL(request.url).searchParams;
    const scope = z.enum(appointmentScopes).parse(params.get("scope") || "today");
    const patientId = params.has("patientId") ? z.uuid().parse(params.get("patientId")) : undefined;
    const where = { facilityId: user.facilityId, scheduledAt: appointmentWindow(scope, now), ...(patientId ? { patientId } : {}), ...(scope === "recall" ? { status: { in: ["NO_SHOW" as const, "SCHEDULED" as const] } } : {}) };
    const appointments = await db.appointment.findMany({
      where,
      include: { patient: { select: { id: true, patientNumber: true, fullName: true, sexAtBirth: true, dateOfBirth: true, estimatedAgeYears: true, contacts: { where: { primary: true }, take: 1, select: { value: true } }, consents: { where: { type: "MESSAGING", granted: true, withdrawnAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, take: 1, select: { id: true } } } }, reminderDeliveries: { orderBy: { preparedAt: "desc" }, take: 3, select: { id: true, status: true, destinationMasked: true, preparedAt: true } } },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: 501,
    });
    const shown = appointments.slice(0, 500);
    await recordDisclosure(user, "APPOINTMENTS", shown.map(item => item.id));
    return privateJson({ appointments: shown, truncated: appointments.length > 500, generatedAt: now.toISOString() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("visit.create");
    const input = inputSchema.parse(await request.json());
    const scheduledAt = new Date(input.scheduledAt);
    if (!appointmentCanBeBooked(scheduledAt))
      throw Object.assign(new Error("Choose a future time within the next 90 days"), { status: 422 });
    const patient = await db.patient.findFirst({ where: { id: input.patientId, facilityId: user.facilityId, active: true } });
    if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });

    const appointment = await db.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: { facilityId: user.facilityId, patientId: patient.id, scheduledAt, clinic: input.clinic, notes: input.notes },
        include: { patient: { include: { contacts: { where: { primary: true }, take: 1 }, consents: { where: { type: "MESSAGING", granted: true, withdrawnAt: null }, take: 1 } } }, reminderDeliveries: true },
      });
      await appendAudit(tx, { userId: user.id, action: "APPOINTMENT_BOOKED", entityType: "Appointment", entityId: created.id, afterHash: `${created.scheduledAt.toISOString()}:${created.clinic}` });
      return created;
    });
    return privateJson({ appointment }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return privateJson({ error: "This patient already has an appointment at that time" }, { status: 409 });
    return apiError(error);
  }
}
