import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { validateCareAssessment } from "@/lib/care-assessment-validation";
import {
  careFieldKeys,
  careServiceForClinic,
  careServiceProfile,
  careServiceProfiles,
  requiredCareFields,
  startOfDayInTimeZone,
} from "@/lib/care-service-points";
import { db } from "@/lib/db";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { apiError, privateJson } from "@/lib/http";
import { applyLnmpDating, dateInTimeZone } from "@/lib/pregnancy-dating";
import { isOpenClinicalVisit } from "@/lib/visit-check-in";
import { assessmentRevision, assessmentConflict } from "@/lib/assessment-revision";
import { nextEncounterTime } from "@/lib/consultation-revision";
import { assessmentAuditFingerprint } from "@/lib/assessment-audit";

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
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
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
          status: true,
          clinicallyClosedAt: true,
          _count: { select: { encounters: { where: { status: { in: ["SIGNED", "CORRECTED"] } } } } },
          encounters: {
            where: { status: { in: ["DRAFT", "SIGNED", "CORRECTED"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, status: true, updatedAt: true, servicePointRecord: { include: { updatedBy: { select: { displayName: true } } } } },
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
      // Include narratives from every encounter in this visit, including an older
      // signed encounter beside a newer draft. Never infer structured revisions.
      const narrativeRows = await db.encounterAddendum.findMany({
        where: { encounter: { visitId: visit.id, visit: { facilityId: user.facilityId } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 21,
        select: { id: true, encounterId: true, text: true, reason: true, createdAt: true, author: { select: { displayName: true } } },
      });
      const addenda = { items: narrativeRows.slice(0, 20), hasMore: narrativeRows.length > 20, limit: 20 };
      await recordDisclosure(user, "SERVICE_POINTS", [visit.id, ...relationships.map(item => item.id), ...addenda.items.map(item => item.id)]);
      return privateJson({
        addenda,
        record: visit.encounters[0]?.servicePointRecord || null,
        assessmentRevision: assessmentRevision(visit.id, visit.encounters[0], visit.encounters[0]?.servicePointRecord),
        encounterStatus: visit.encounters[0]?.status || null,
        readOnly: !isOpenClinicalVisit(visit) || visit._count.encounters > 0,
        visitStatus: visit.status,
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
    await recordDisclosure(user, "SERVICE_POINTS", [], metrics);
    return privateJson({ metrics });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("encounter.write");
    const input = inputSchema.parse(await request.json());
    if (input.action === "SAVE_ASSESSMENT" && input.expectedRevision === undefined)
      throw Object.assign(new Error("Reload the assessment before saving. This screen has no saved revision."), { status: 428 });
    const result = await db.$transaction(async (tx) => {
      const visit = await tx.visit.findFirst({
        where: { id: input.visitId, facilityId: user.facilityId },
        include: {
          patient: { select: { id: true } },
          ancAdmissionEvidence: { select: { safeguardingReviewRequired: true } },
          encounters: { orderBy: { createdAt: "desc" }, include: { servicePointRecord: true } },
        },
      });
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      if (!isOpenClinicalVisit(visit))
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
      let assessmentData = input.data;
      if (profile.code === "ANC" && typeof input.data.lmp === "string" && input.data.lmp) {
        const calculated = applyLnmpDating(input.data, dateInTimeZone(new Date(), user.facility.timezone));
        if (!calculated.dating)
          throw Object.assign(new Error("LNMP must be a valid date that is not in the future"), { status: 422 });
        assessmentData = calculated.data;
      }
      const missing = requiredCareFields(profile.code).filter((key) => !isPresent(assessmentData[key]));
      if (missing.length)
        throw Object.assign(new Error(`Complete the required assessment fields: ${missing.join(", ")}`), { status: 422 });
      const validation = validateCareAssessment(profile, assessmentData);
      if (validation.errors.length)
        throw Object.assign(new Error(validation.errors.map((issue) => issue.message).join(" ")), { status: 422 });
      if (
        profile.code === "ANC" &&
        visit.ancAdmissionEvidence?.safeguardingReviewRequired &&
        (!isPresent(assessmentData.safeguardingAssessment) || !isPresent(assessmentData.safeguardingAction))
      )
        throw Object.assign(
          new Error("Complete the confidential safeguarding assessment and action pathway before saving this adolescent ANC assessment"),
          { status: 422 },
        );

      const signed = visit.encounters.find((encounter) => ["SIGNED", "CORRECTED"].includes(encounter.status));
      if (signed)
        throw Object.assign(new Error("This encounter is signed or corrected and its assessment cannot be replaced. Review its saved assessment and narrative addendum history."), { status: 409 });
      let encounter = visit.encounters.find((item) => item.status === "DRAFT");
      if (input.expectedRevision !== assessmentRevision(visit.id, encounter, encounter?.servicePointRecord))
        throw assessmentConflict();
      const beforeHash = assessmentAuditFingerprint(user.facilityId, visit.id, encounter?.servicePointRecord ?? null);
      // All assessment saves also write the visit read above. Concurrent first
      // creates and closure must contend on this row even without an encounter.
      await tx.visit.update({
        where: { id: visit.id, updatedAt: visit.updatedAt, status: visit.status, clinicallyClosedAt: null },
        data: { updatedAt: nextEncounterTime(visit.updatedAt), ...(visit.status === "AWAITING_CLINICIAN" ? { status: "UNDER_CONSULTATION" as const } : {}) },
      });
      // Couple every assessment edit to the revision already checked by consultation
      // saves/signing. The conditional write and record/audit stay in this transaction.
      if (encounter) {
        encounter = await tx.encounter.update({
          where: { id: encounter.id, updatedAt: encounter.updatedAt, status: "DRAFT" },
          data: { updatedAt: nextEncounterTime(encounter.updatedAt) },
          include: { servicePointRecord: true },
        });
      }
      if (!encounter) {
        encounter = await tx.encounter.create({
          data: { visitId: visit.id, clinicianId: user.id, noteFormat: "STRUCTURED", status: "DRAFT" },
          include: { servicePointRecord: true },
        });
      }
      const record = await tx.servicePointRecord.upsert({
        include: { updatedBy: { select: { displayName: true } } },
        where: { encounterId: encounter.id },
        update: {
          servicePoint: profile.code,
          templateVersion: profile.templateVersion,
          data: assessmentData as Prisma.InputJsonObject,
          riskLevel: input.riskLevel,
          followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
          updatedById: user.id,
        },
        create: {
          encounterId: encounter.id,
          servicePoint: profile.code,
          templateVersion: profile.templateVersion,
          data: assessmentData as Prisma.InputJsonObject,
          riskLevel: input.riskLevel,
          followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
          updatedById: user.id,
        },
      });
      if (visit.status === "AWAITING_CLINICIAN") {
        await tx.queueEntry.updateMany({
          where: { visitId: visit.id, servicePoint: "CONSULTATION", status: { in: ["WAITING", "CALLED"] } },
          data: { status: "IN_PROGRESS", startedAt: new Date() },
        });
      }
      await appendAudit(tx, {
        userId: user.id,
        action: "SERVICE_POINT_ASSESSMENT_SAVED",
        facilityId: user.facilityId,
        sessionId: user.sessionId,
        entityType: "ServicePointRecord",
        entityId: record.id,
        beforeHash,
        afterHash: assessmentAuditFingerprint(user.facilityId, visit.id, record),
      });
      return { record, assessmentRevision: assessmentRevision(visit.id, encounter, record), warnings: validation.warnings.map((issue) => issue.message) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return privateJson(result);
  } catch (error) {
    return apiError(error);
  }
}
