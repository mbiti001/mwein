import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import {
  careFieldKeys,
  careServiceForClinic,
  careServiceProfile,
  careServiceProfiles,
  requiredCareFields,
  startOfDayInTimeZone,
} from "@/lib/care-service-points";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const serviceCode = z.enum([
  "ANC",
  "MCH_PNC",
  "DIABETES",
  "DIALYSIS",
  "CANCER",
  "SICKLE_CELL",
  "WALK_IN",
]);

const assessmentInput = z.object({
  action: z.literal("SAVE_ASSESSMENT"),
  visitId: z.uuid(),
  servicePoint: serviceCode,
  templateVersion: z.string().trim().min(3).max(60),
  data: z.record(
    z.string().trim().min(1).max(80),
    z.union([z.string().trim().max(5000), z.boolean()]),
  ),
  riskLevel: z.enum(["ROUTINE", "INCREASED", "HIGH", "EMERGENCY"]),
  followUpAt: z.iso.date().optional(),
});

const relationshipInput = z.object({
  action: z.literal("LINK_PATIENT"),
  visitId: z.uuid(),
  relatedPatientId: z.uuid(),
  relationship: z.enum(["MOTHER_OF", "CHILD_OF", "GUARDIAN_OF", "DEPENDANT_OF"]),
});

const inputSchema = z.discriminatedUnion("action", [assessmentInput, relationshipInput]);

function isPresent(value: string | boolean | undefined) {
  return typeof value === "boolean" ? value : Boolean(value?.trim());
}

export async function GET(request: Request) {
  try {
    const user = await requirePermission("encounter.write");
    const visitId = new URL(request.url).searchParams.get("visitId");
    if (visitId) {
      const visit = await db.visit.findFirst({
        where: { id: z.uuid().parse(visitId), facilityId: user.facilityId },
        select: {
          id: true,
          clinic: true,
          patientId: true,
          encounters: {
            where: { status: { in: ["DRAFT", "SIGNED"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, status: true, servicePointRecord: true },
          },
        },
      });
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      const relationships = await db.patientRelationship.findMany({
        where: { OR: [{ patientId: visit.patientId }, { relatedPatientId: visit.patientId }] },
        include: {
          patient: { select: { id: true, patientNumber: true, fullName: true } },
          relatedPatient: { select: { id: true, patientNumber: true, fullName: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return NextResponse.json({
        record: visit.encounters[0]?.servicePointRecord || null,
        encounterStatus: visit.encounters[0]?.status || null,
        relationships,
      });
    }

    const dayStart = startOfDayInTimeZone(new Date(), user.facility.timezone);
    const [visits, followUps, referrals] = await Promise.all([
      db.visit.findMany({
        where: {
          facilityId: user.facilityId,
          OR: [
            { status: { notIn: ["COMPLETED", "CANCELLED"] } },
            { completedAt: { gte: dayStart } },
          ],
        },
        select: {
          clinic: true,
          status: true,
          completedAt: true,
          orders: {
            where: {
              type: { in: ["LABORATORY", "IMAGING"] },
              status: { in: ["REQUESTED", "IN_PROGRESS"] },
            },
            select: { id: true },
          },
        },
      }),
      db.servicePointRecord.findMany({
        where: {
          encounter: { visit: { facilityId: user.facilityId } },
          followUpAt: { gte: dayStart },
        },
        select: { servicePoint: true, followUpAt: true },
      }),
      db.referral.findMany({
        where: {
          facilityId: user.facilityId,
          OR: [
            { status: { not: "CLOSED" } },
            { returnedAt: { gte: dayStart } },
            { closedAt: { gte: dayStart } },
          ],
        },
        select: { status: true, sentAt: true, returnedAt: true, closedAt: true },
      }),
    ]);

    const metrics = Object.fromEntries(
      careServiceProfiles.map((profile) => {
        if (profile.code === "REFERRAL") {
          return [profile.code, {
            waiting: referrals.filter((item) => ["DRAFT", "SENT"].includes(item.status)).length,
            beingSeen: referrals.filter((item) => ["ACCEPTED", "ATTENDED"].includes(item.status)).length,
            completed: referrals.filter((item) =>
              (item.returnedAt && item.returnedAt >= dayStart) ||
              (item.closedAt && item.closedAt >= dayStart),
            ).length,
            pendingInvestigations: 0,
            followUps: 0,
            referrals: referrals.filter((item) => item.sentAt && item.sentAt >= dayStart).length,
          }];
        }
        const matching = visits.filter((visit) => careServiceForClinic(visit.clinic)?.code === profile.code);
        return [profile.code, {
          waiting: matching.filter((visit) => ["AWAITING_TRIAGE", "AWAITING_CLINICIAN"].includes(visit.status)).length,
          beingSeen: matching.filter((visit) => ["UNDER_CONSULTATION", "ORDERS_PENDING", "AWAITING_RESULTS"].includes(visit.status)).length,
          completed: matching.filter((visit) => visit.completedAt && visit.completedAt >= dayStart).length,
          pendingInvestigations: matching.reduce((count, visit) => count + visit.orders.length, 0),
          followUps: followUps.filter((item) => item.servicePoint === profile.code).length,
          referrals: 0,
        }];
      }),
    );
    return NextResponse.json({ metrics });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("encounter.write");
    const input = inputSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const visit = await tx.visit.findFirst({
        where: { id: input.visitId, facilityId: user.facilityId },
        include: {
          patient: { select: { id: true } },
          encounters: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      if (["COMPLETED", "CANCELLED"].includes(visit.status))
        throw Object.assign(new Error("This visit is closed and cannot be changed"), { status: 409 });

      if (input.action === "LINK_PATIENT") {
        if (visit.patientId === input.relatedPatientId)
          throw Object.assign(new Error("A patient cannot be linked to their own record"), { status: 422 });
        const relatedPatient = await tx.patient.findFirst({
          where: { id: input.relatedPatientId, facilityId: user.facilityId, active: true },
          select: { id: true, fullName: true },
        });
        if (!relatedPatient) throw Object.assign(new Error("Linked patient not found"), { status: 404 });
        const relationship = await tx.patientRelationship.upsert({
          where: {
            patientId_relatedPatientId_relationship: {
              patientId: visit.patientId,
              relatedPatientId: relatedPatient.id,
              relationship: input.relationship,
            },
          },
          update: {},
          create: {
            patientId: visit.patientId,
            relatedPatientId: relatedPatient.id,
            relationship: input.relationship,
            createdById: user.id,
          },
        });
        await appendAudit(tx, {
          userId: user.id,
          action: "PATIENT_RELATIONSHIP_LINKED",
          entityType: "PatientRelationship",
          entityId: relationship.id,
          afterHash: input.relationship,
        });
        return { relationship, linkedPatient: relatedPatient };
      }

      const profile = careServiceProfile(input.servicePoint)!;
      const visitProfile = careServiceForClinic(visit.clinic);
      if (visitProfile?.code !== profile.code)
        throw Object.assign(new Error(`${visit.clinic} visits cannot use the ${profile.label} assessment`), { status: 422 });
      if (profile.templateVersion !== input.templateVersion)
        throw Object.assign(new Error("This clinical template changed. Refresh before saving."), { status: 409 });

      const allowedKeys = careFieldKeys(profile.code);
      const unknownKey = Object.keys(input.data).find((key) => !allowedKeys.has(key));
      if (unknownKey)
        throw Object.assign(new Error(`Unrecognised field: ${unknownKey}`), { status: 422 });
      const missing = requiredCareFields(profile.code).filter((key) => !isPresent(input.data[key]));
      if (missing.length)
        throw Object.assign(new Error(`Complete the required assessment fields: ${missing.join(", ")}`), { status: 422 });

      const signed = visit.encounters.find((encounter) => encounter.status === "SIGNED");
      if (signed)
        throw Object.assign(new Error("This encounter is signed. Add an authorised addendum instead of changing the assessment."), { status: 409 });
      let encounter = visit.encounters.find((item) => item.status === "DRAFT");
      if (!encounter) {
        encounter = await tx.encounter.create({
          data: { visitId: visit.id, clinicianId: user.id, noteFormat: "STRUCTURED", status: "DRAFT" },
        });
      }
      const record = await tx.servicePointRecord.upsert({
        where: { encounterId: encounter.id },
        update: {
          servicePoint: profile.code,
          templateVersion: profile.templateVersion,
          data: input.data as Prisma.InputJsonObject,
          riskLevel: input.riskLevel,
          followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
          updatedById: user.id,
        },
        create: {
          encounterId: encounter.id,
          servicePoint: profile.code,
          templateVersion: profile.templateVersion,
          data: input.data as Prisma.InputJsonObject,
          riskLevel: input.riskLevel,
          followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
          updatedById: user.id,
        },
      });
      if (visit.status === "AWAITING_CLINICIAN") {
        await tx.visit.update({ where: { id: visit.id }, data: { status: "UNDER_CONSULTATION" } });
        await tx.queueEntry.updateMany({
          where: { visitId: visit.id, servicePoint: "CONSULTATION", status: { in: ["WAITING", "CALLED"] } },
          data: { status: "IN_PROGRESS", startedAt: new Date() },
        });
      }
      await appendAudit(tx, {
        userId: user.id,
        action: "SERVICE_POINT_ASSESSMENT_SAVED",
        entityType: "ServicePointRecord",
        entityId: record.id,
        afterHash: `${profile.code}:${profile.templateVersion}:${Object.keys(input.data).sort().join("|")}`,
      });
      return { record };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
