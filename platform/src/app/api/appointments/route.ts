import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appointmentCanBeBooked, appointmentClinics } from "@/lib/appointments";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const inputSchema = z.object({
  patientId: z.uuid(),
  scheduledAt: z.iso.datetime({ offset: true }),
  clinic: z.enum(appointmentClinics),
  notes: z.string().trim().max(300).optional(),
});

export async function GET() {
  try {
    const user = await requirePermission("visit.read");
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 31);
    const appointments = await db.appointment.findMany({
      where: { facilityId: user.facilityId, scheduledAt: { gte: start, lt: end } },
      include: { patient: { include: { contacts: { where: { primary: true }, take: 1 }, consents: { where: { type: "MESSAGING", granted: true, withdrawnAt: null }, take: 1 } } } },
      orderBy: { scheduledAt: "asc" },
    });
    return NextResponse.json({ appointments });
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
        include: { patient: { include: { contacts: { where: { primary: true }, take: 1 }, consents: { where: { type: "MESSAGING", granted: true, withdrawnAt: null }, take: 1 } } } },
      });
      await appendAudit(tx, { userId: user.id, action: "APPOINTMENT_BOOKED", entityType: "Appointment", entityId: created.id, afterHash: `${created.scheduledAt.toISOString()}:${created.clinic}` });
      return created;
    });
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "This patient already has an appointment at that time" }, { status: 409 });
    return apiError(error);
  }
}
