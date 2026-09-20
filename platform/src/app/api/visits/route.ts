import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { operationalReference } from "@/lib/domain";
import { appointmentClinics } from "@/lib/appointments";
import { assessAncAdmission } from "@/lib/clinic-admission";
import { visitAccessProfile, visitOrderTypes } from "@/lib/visit-access";
import { effectiveCatalogPrice } from "@/lib/catalog-pricing";

const visitInput = z.object({
  patientId: z.uuid(),
  appointmentId: z.uuid().optional(),
  clinic: z.union([z.enum(appointmentClinics), z.literal("DM")]),
  priority: z.enum(["ROUTINE", "PRIORITY", "URGENT", "EMERGENCY"]),
  visitType: z.enum(["WALK_IN", "APPOINTMENT", "EMERGENCY"]).default("WALK_IN"),
  ancEvidence: z.object({
    result: z.enum(["POSITIVE", "NEGATIVE", "PENDING", "NOT_TESTED"]),
    method: z.enum(["FACILITY_LAB", "EXTERNAL_LAB"]),
    testedAt: z.iso.date(),
    evidenceReference: z.string().trim().min(3).max(160),
    consentConfirmed: z.boolean(),
  }).optional(),
});

export async function GET() {
  try {
    const user = await requirePermission("visit.read");
    const access = visitAccessProfile(user.permissions);
    const orderTypes = visitOrderTypes(access);
    const visits = await db.visit.findMany({
      where: {
        facilityId: user.facilityId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      select: {
        id: true,
        visitNumber: true,
        clinic: true,
        visitType: true,
        priority: true,
        status: true,
        ...(access.clinical || access.triage ? { reason: true } : {}),
        arrivedAt: true,
        completedAt: true,
        facility: { select: { name: true, code: true } },
        patient: {
          select: {
            id: true,
            patientNumber: true,
            fullName: true,
            dateOfBirth: true,
            estimatedAgeYears: true,
            sexAtBirth: true,
            ...(access.clinical ? {
              contacts: { orderBy: [{ primary: "desc" as const }, { type: "asc" as const }] },
              identifiers: true,
            } : {}),
            ...(access.clinical || access.pharmacy || access.triage ? {
              allergies: { where: { active: true } },
            } : {}),
          },
        },
        ...(access.clinical || access.pharmacy || access.triage ? { triage: { include: { observations: true } } } : {}),
        ...(access.clinical || access.triage ? { ancAdmissionEvidence: {
          select: {
            result: true,
            method: true,
            testedAt: true,
            evidenceReference: true,
            consentConfirmed: true,
            safeguardingReviewRequired: true,
            recordedAt: true,
          },
        } } : {}),
        ...(access.clinical || access.pharmacy ? { encounters: {
          where: { status: { in: ["DRAFT", "SIGNED"] } },
          include: { diagnoses: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        } } : {}),
        ...(orderTypes.length ? { orders: {
          where: access.clinical ? undefined : { type: { in: [...orderTypes] } },
          include: {
            orderedBy: { select: { displayName: true } },
            ...(access.clinical || access.laboratory ? { laboratory: {
              include: {
                result: {
                  include: {
                    items: true,
                    recordedBy: { select: { displayName: true } },
                    verifiedBy: { select: { displayName: true } },
                  },
                },
              },
            } } : {}),
            ...(access.clinical || access.imaging ? { imaging: { include: { result: { include: { performedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } } } } } } : {}),
            ...(access.clinical || access.pharmacy ? { prescription: { include: {
              dispensedBy: { select: { displayName: true } },
              stockMovements: { where: { type: "DISPENSE" }, include: { batch: { select: { batchNumber: true, expiryDate: true } } }, orderBy: { occurredAt: "asc" } },
              dispensations: {
                include: {
                  catalogItem: { select: { code: true, name: true } },
                  items: { include: { batch: { select: { batchNumber: true, expiryDate: true } } } },
                },
                orderBy: { dispensedAt: "asc" },
              },
            } } } : {}),
          },
          orderBy: { requestedAt: "asc" },
        } } : {}),
        queues: {
          where: { status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
          orderBy: { enteredAt: "desc" },
          take: 1,
        },
        ...(access.billing ? {
          invoice: { include: { items: true, payments: { include: { receipt: true }, orderBy: { receivedAt: "asc" } }, claims: { include: { lines: true }, orderBy: { createdAt: "desc" } } } },
        } : access.clinical ? {
          invoice: { select: {
            id: true,
            invoiceNumber: true,
            status: true,
            currency: true,
            items: { where: { id: { in: [] } } },
            payments: { where: { id: { in: [] } } },
            claims: { include: { lines: true }, orderBy: { createdAt: "desc" as const } },
          } },
        } : {}),
      },
      orderBy: [{ priority: "desc" }, { arrivedAt: "asc" }],
    });
    const rank = { EMERGENCY: 0, URGENT: 1, PRIORITY: 2, ROUTINE: 3 };
    visits.sort(
      (a, b) =>
        rank[a.priority] - rank[b.priority] ||
        a.arrivedAt.getTime() - b.arrivedAt.getTime(),
    );
    await recordClinicalAccess(user, "VISIT_WORKLIST", visits.map(({ id }) => ({ type: "Visit", id })));
    return NextResponse.json({ visits }, { headers: { "Cache-Control": "private, no-store" } });
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
        const clinic = appointment?.clinic || input.clinic;
        const consultationCode = `CONSULT-${clinic.toUpperCase()}`;
        const consultationTariff = await tx.catalogItem.findUnique({
          where: { facilityId_code: { facilityId: user.facilityId, code: consultationCode } },
          include: { priceVersions: true },
        });
        const emergency = clinic === "Emergency" || input.visitType === "EMERGENCY" || ["URGENT", "EMERGENCY"].includes(input.priority);
        if ((!consultationTariff?.active || consultationTariff.currency !== "KES") && !emergency)
          throw Object.assign(new Error(`Configure an active KES consultation tariff for ${clinic} in Services & pricing before check-in`), { status: 409 });
        const consultationPrice = consultationTariff?.active && consultationTariff.currency === "KES" ? effectiveCatalogPrice(consultationTariff) : null;
        if (clinic !== "ANC" && input.ancEvidence)
          throw Object.assign(new Error("Pregnancy-test evidence may only be recorded for ANC check-in"), { status: 422 });
        if (clinic === "ANC" && input.visitType === "EMERGENCY")
          throw Object.assign(new Error("Emergency presentations must be checked into Emergency and must not be delayed for pregnancy confirmation"), { status: 422 });
        const ancDecision = clinic === "ANC"
          ? assessAncAdmission(patient, input.ancEvidence)
          : null;
        if (ancDecision && !ancDecision.admitted)
          throw Object.assign(new Error(ancDecision.reason), { status: 422 });
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
        const directWalkIn = clinic === "Walk-in";
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
            clinic,
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
            ...(ancDecision?.admitted ? {
              ancAdmissionEvidence: {
                create: {
                  facilityId: user.facilityId,
                  result: "POSITIVE",
                  method: input.ancEvidence!.method,
                  testedAt: new Date(`${input.ancEvidence!.testedAt}T00:00:00.000Z`),
                  evidenceReference: input.ancEvidence!.evidenceReference,
                  consentConfirmed: true,
                  safeguardingReviewRequired: ancDecision.safeguardingReviewRequired,
                  recordedById: user.id,
                },
              },
            } : {}),
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
                    serviceCode: consultationCode,
                    catalogItemId: consultationPrice ? consultationTariff!.id : undefined,
                    priceVersionId: consultationPrice?.priceVersionId,
                    description: `${clinic} consultation`,
                    quantity: new Prisma.Decimal(1),
                    unitPrice: new Prisma.Decimal(
                      consultationPrice?.unitPrice.toString() ?? "0.00",
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
            ancAdmissionEvidence: true,
          },
        });
        await appendAudit(tx, {
          userId: user.id,
          action: "VISIT_CREATED",
          entityType: "Visit",
          entityId: visit.id,
          afterHash: `${visit.visitNumber}:${visit.status}`,
        });
        if (ancDecision?.admitted)
          await appendAudit(tx, {
            userId: user.id,
            action: "ANC_ADMISSION_CONFIRMED",
            entityType: "AncAdmissionEvidence",
            entityId: visit.ancAdmissionEvidence!.id,
            afterHash: `${input.ancEvidence!.method}:${input.ancEvidence!.testedAt}:${ancDecision.safeguardingReviewRequired ? "SAFEGUARDING_REVIEW" : "ROUTINE"}`,
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
