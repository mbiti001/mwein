import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { operationalReference } from "@/lib/domain";
import { apiError } from "@/lib/http";
import {
  REFERRAL_ATTACHMENT_METADATA_VERSION,
  referralInput,
  serializeReferral,
} from "@/lib/referrals";

const referralInclude = {
  patient: { select: { id: true, patientNumber: true, fullName: true, dateOfBirth: true, sexAtBirth: true } },
  visit: { select: { id: true, visitNumber: true, clinic: true, arrivedAt: true } },
  createdBy: { select: { displayName: true } },
  updatedBy: { select: { displayName: true } },
  attachments: {
    include: { attachedBy: { select: { displayName: true } } },
    orderBy: { attachedAt: "asc" },
  },
  acknowledgements: {
    include: { recordedBy: { select: { displayName: true } } },
    orderBy: { acknowledgedAt: "asc" },
  },
} satisfies Prisma.ReferralInclude;

export async function GET(request: Request) {
  try {
    const user = await requirePermission("referral.read");
    const url = new URL(request.url);
    const query = z.string().trim().max(120).parse(url.searchParams.get("q") || "");
    const status = z.string().trim().max(30).parse(url.searchParams.get("status") || "");
    const referrals = await db.referral.findMany({
      where: {
        facilityId: user.facilityId,
        ...(status ? { status } : {}),
        ...(query ? {
          OR: [
            { referralNumber: { contains: query, mode: "insensitive" } },
            { receivingFacility: { contains: query, mode: "insensitive" } },
            { receivingDepartment: { contains: query, mode: "insensitive" } },
            { patient: { fullName: { contains: query, mode: "insensitive" } } },
            { patient: { patientNumber: { contains: query, mode: "insensitive" } } },
          ],
        } : {}),
      },
      include: referralInclude,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ referrals: referrals.map(serializeReferral) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("encounter.write");
    const input = referralInput.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const replay = await tx.referral.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: referralInclude,
      });
      if (replay) {
        if (replay.facilityId !== user.facilityId)
          throw Object.assign(new Error("This referral request cannot be replayed"), { status: 409 });
        return serializeReferral(replay);
      }
      const visit = await tx.visit.findFirst({
        where: { id: input.visitId, facilityId: user.facilityId },
        include: {
          patient: true,
          encounters: {
            where: { status: { in: ["DRAFT", "SIGNED"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      if (["COMPLETED", "CANCELLED"].includes(visit.status))
        throw Object.assign(new Error("A new referral cannot be added to a closed visit"), { status: 409 });
      const laboratoryResultIds = input.attachments
        .filter((item) => item.sourceType === "LABORATORY_RESULT")
        .map((item) => item.resultId);
      const imagingResultIds = input.attachments
        .filter((item) => item.sourceType === "IMAGING_RESULT")
        .map((item) => item.resultId);
      if (new Set(input.attachments.map((item) => `${item.sourceType}:${item.resultId}`)).size !== input.attachments.length)
        throw Object.assign(new Error("Each clinical result can only be attached once"), { status: 422 });
      const [laboratoryResults, imagingResults] = await Promise.all([
        tx.laboratoryResult.findMany({
          where: {
            id: { in: laboratoryResultIds },
            status: "VERIFIED",
            verifiedAt: { not: null },
            laboratoryOrder: { order: { visitId: visit.id } },
          },
          include: {
            laboratoryOrder: {
              include: { order: { select: { id: true, displayName: true } } },
            },
          },
        }),
        tx.imagingResult.findMany({
          where: {
            id: { in: imagingResultIds },
            status: "VERIFIED",
            verifiedAt: { not: null },
            imagingOrder: { order: { visitId: visit.id } },
          },
          include: {
            imagingOrder: {
              include: { order: { select: { id: true, displayName: true } } },
            },
          },
        }),
      ]);
      if (
        laboratoryResults.length !== laboratoryResultIds.length ||
        imagingResults.length !== imagingResultIds.length
      )
        throw Object.assign(
          new Error("Attachments must be verified laboratory or imaging results from this visit"),
          { status: 422 },
        );
      const attachmentCreates: Prisma.ReferralAttachmentCreateWithoutReferralInput[] = [
        ...laboratoryResults.map((result) => ({
          sourceType: "LABORATORY_RESULT",
          laboratoryResult: { connect: { id: result.id } },
          metadataVersion: REFERRAL_ATTACHMENT_METADATA_VERSION,
          metadata: {
            displayName: result.laboratoryOrder.order.displayName,
            orderId: result.laboratoryOrder.order.id,
            testCode: result.laboratoryOrder.testCode,
            accessionNumber: result.laboratoryOrder.accessionNumber,
            resultStatus: result.status,
            verifiedAt: result.verifiedAt!.toISOString(),
          },
          attachedBy: { connect: { id: user.id } },
        })),
        ...imagingResults.map((result) => ({
          sourceType: "IMAGING_RESULT",
          imagingResult: { connect: { id: result.id } },
          metadataVersion: REFERRAL_ATTACHMENT_METADATA_VERSION,
          metadata: {
            displayName: result.imagingOrder.order.displayName,
            orderId: result.imagingOrder.order.id,
            examinationCode: result.imagingOrder.examinationCode,
            modality: result.imagingOrder.modality,
            resultStatus: result.status,
            verifiedAt: result.verifiedAt!.toISOString(),
          },
          attachedBy: { connect: { id: user.id } },
        })),
      ];
      const facility = await tx.facility.findUniqueOrThrow({ where: { id: user.facilityId } });
      const year = new Date().getFullYear();
      const sequence = await tx.referenceSequence.upsert({
        where: { facilityId_kind_year: { facilityId: user.facilityId, kind: "REFERRAL", year } },
        update: { nextValue: { increment: 1 } },
        create: { facilityId: user.facilityId, kind: "REFERRAL", year, nextValue: 2 },
      });
      const referral = await tx.referral.create({
        data: {
          facilityId: user.facilityId,
          visitId: visit.id,
          patientId: visit.patientId,
          encounterId: visit.encounters[0]?.id,
          idempotencyKey: input.idempotencyKey,
          referralNumber: operationalReference(facility.code, "REF", year, sequence.nextValue - 1n),
          type: input.type,
          referrerName: user.displayName,
          referringFacility: facility.name,
          referringDepartment: input.referringDepartment,
          reason: input.reason,
          clinicalSummary: input.clinicalSummary,
          diagnosisSummary: input.diagnosisSummary,
          urgency: input.urgency,
          attachments: attachmentCreates.length ? { create: attachmentCreates } : undefined,
          receivingFacility: input.receivingFacility,
          receivingDepartment: input.receivingDepartment,
          appointmentAt: input.appointmentAt ? new Date(input.appointmentAt) : null,
          status: "DRAFT",
          createdById: user.id,
          updatedById: user.id,
        },
        include: referralInclude,
      });
      await appendAudit(tx, {
        userId: user.id,
        action: "REFERRAL_CREATED",
        entityType: "Referral",
        entityId: referral.id,
        afterHash: `${referral.referralNumber}:${referral.type}:${referral.urgency}:attachments=${attachmentCreates.length}`,
      });
      return serializeReferral(referral);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ referral: result }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
