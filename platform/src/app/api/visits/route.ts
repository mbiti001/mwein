import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { operationalReference } from "@/lib/domain";
import { appointmentClinics } from "@/lib/appointments";

const visitInput = z.object({
  patientId: z.uuid(),
  appointmentId: z.uuid().optional(),
  clinic: z.union([z.enum(appointmentClinics), z.literal("DM")]),
  priority: z.enum(["ROUTINE", "PRIORITY", "URGENT", "EMERGENCY"]),
  visitType: z.enum(["WALK_IN", "APPOINTMENT", "EMERGENCY"]).default("WALK_IN"),
});

export async function GET() {
  try {
    const user = await requirePermission("visit.read");
    const visits = await db.visit.findMany({
      where: {
        facilityId: user.facilityId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      include: {
        facility: { select: { name: true, code: true } },
        patient: { include: { allergies: { where: { active: true } } } },
        triage: { include: { observations: true } },
        encounters: {
          where: { status: { in: ["DRAFT", "SIGNED"] } },
          include: { diagnoses: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        orders: {
          include: {
            orderedBy: { select: { displayName: true } },
            laboratory: {
              include: {
                result: {
                  include: {
                    items: true,
                    recordedBy: { select: { displayName: true } },
                    verifiedBy: { select: { displayName: true } },
                  },
                },
              },
            },
            imaging: { include: { result: { include: { performedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } } } } },
            prescription: { include: {
              dispensedBy: { select: { displayName: true } },
              stockMovements: { where: { type: "DISPENSE" }, include: { batch: { select: { batchNumber: true, expiryDate: true } } }, orderBy: { occurredAt: "asc" } },
            } },
          },
          orderBy: { requestedAt: "asc" },
        },
        queues: {
          where: { status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
          orderBy: { enteredAt: "desc" },
          take: 1,
        },
        invoice: { include: { items: true, payments: { include: { receipt: true }, orderBy: { receivedAt: "asc" } }, claims: { include: { lines: true }, orderBy: { createdAt: "desc" } } } },
      },
      orderBy: [{ priority: "desc" }, { arrivedAt: "asc" }],
    });
    const rank = { EMERGENCY: 0, URGENT: 1, PRIORITY: 2, ROUTINE: 3 };
    visits.sort(
      (a, b) =>
        rank[a.priority] - rank[b.priority] ||
        a.arrivedAt.getTime() - b.arrivedAt.getTime(),
    );
    return NextResponse.json({ visits });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("visit.create");
    const input = visitInput.parse(await request.json());
    const patient = await db.patient.findFirst({
      where: { id: input.patientId, facilityId: user.facilityId, active: true },
    });
    if (!patient)
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    const duplicate = await db.visit.findFirst({
      where: {
        patientId: patient.id,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      select: { id: true, visitNumber: true, status: true },
    });
    if (duplicate)
      return NextResponse.json(
        { error: "Patient already has an active visit", visit: duplicate },
        { status: 409 },
      );
    const result = await db.$transaction(
      async (tx) => {
        const appointment = input.appointmentId
          ? await tx.appointment.findFirst({
              where: {
                id: input.appointmentId,
                facilityId: user.facilityId,
                patientId: patient.id,
                status: "SCHEDULED",
              },
            })
          : null;
        if (input.appointmentId && !appointment)
          throw Object.assign(new Error("Scheduled appointment is no longer available"), { status: 409 });
        const facility = await tx.facility.findUniqueOrThrow({
          where: { id: user.facilityId },
        });
        const year = new Date().getFullYear();
        const visitSequence = await tx.referenceSequence.upsert({
          where: {
            facilityId_kind_year: {
              facilityId: user.facilityId,
              kind: "VISIT",
              year,
            },
          },
          update: { nextValue: { increment: 1 } },
          create: {
            facilityId: user.facilityId,
            kind: "VISIT",
            year,
            nextValue: 2,
          },
        });
        const invoiceSequence = await tx.referenceSequence.upsert({
          where: {
            facilityId_kind_year: {
              facilityId: user.facilityId,
              kind: "INVOICE",
              year,
            },
          },
          update: { nextValue: { increment: 1 } },
          create: {
            facilityId: user.facilityId,
            kind: "INVOICE",
            year,
            nextValue: 2,
          },
        });
        const directWalkIn = (appointment?.clinic || input.clinic) === "Walk-in";
        const visit = await tx.visit.create({
          data: {
            facilityId: user.facilityId,
            patientId: patient.id,
            appointmentId: appointment?.id,
            visitNumber: operationalReference(
              facility.code,
              "V",
              year,
              visitSequence.nextValue - 1n,
            ),
            clinic: appointment?.clinic || input.clinic,
            visitType: appointment ? "APPOINTMENT" : input.visitType,
            priority: input.priority,
            status: directWalkIn ? "AWAITING_CLINICIAN" : "AWAITING_TRIAGE",
            reason: "Clinical complaint deferred to private consultation",
            queues: {
              create: {
                servicePoint: directWalkIn ? "CONSULTATION" : "TRIAGE",
                priority: input.priority,
                status: "WAITING",
              },
            },
            invoice: {
              create: {
                patientId: patient.id,
                invoiceNumber: operationalReference(
                  facility.code,
                  "INV",
                  year,
                  invoiceSequence.nextValue - 1n,
                ),
                items: {
                  create: {
                    serviceCode: `CONSULT-${input.clinic.toUpperCase()}`,
                    description: `${input.clinic} consultation`,
                    quantity: new Prisma.Decimal(1),
                    unitPrice: new Prisma.Decimal(
                      input.clinic === "Emergency" ? "0.00" : "500.00",
                    ),
                  },
                },
              },
            },
          },
          include: {
            patient: true,
            queues: true,
            invoice: { include: { items: true } },
          },
        });
        await appendAudit(tx, {
          userId: user.id,
          action: "VISIT_CREATED",
          entityType: "Visit",
          entityId: visit.id,
          afterHash: `${visit.visitNumber}:${visit.status}`,
        });
        if (appointment) {
          await tx.appointment.update({ where: { id: appointment.id }, data: { status: "COMPLETED" } });
          await appendAudit(tx, {
            userId: user.id,
            action: "APPOINTMENT_CHECKED_IN",
            entityType: "Appointment",
            entityId: appointment.id,
            beforeHash: "SCHEDULED",
            afterHash: visit.visitNumber,
          });
        }
        return visit;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json({ visit: result }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
