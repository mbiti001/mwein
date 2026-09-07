import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { operationalReference } from "@/lib/domain";
import { apiError } from "@/lib/http";

const referralInput = z.object({
  visitId: z.uuid(),
  idempotencyKey: z.uuid(),
  type: z.enum(["INTERNAL", "EXTERNAL"]),
  referringDepartment: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(3).max(2000),
  clinicalSummary: z.string().trim().min(10).max(5000),
  diagnosisSummary: z.string().trim().min(2).max(1200),
  urgency: z.enum(["ROUTINE", "PRIORITY", "URGENT", "EMERGENCY"]),
  attachedResults: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  receivingFacility: z.string().trim().min(2).max(240),
  receivingDepartment: z.string().trim().max(160).optional(),
  appointmentAt: z.iso.datetime().optional(),
});

const referralInclude = {
  patient: { select: { id: true, patientNumber: true, fullName: true, dateOfBirth: true, sexAtBirth: true } },
  visit: { select: { id: true, visitNumber: true, clinic: true, arrivedAt: true } },
  createdBy: { select: { displayName: true } },
  updatedBy: { select: { displayName: true } },
} satisfies Prisma.ReferralInclude;

export async function GET(request: Request) {
  try {
    const user = await requirePermission("visit.read");
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
    return NextResponse.json({ referrals });
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
        return replay;
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
          attachedResults: input.attachedResults,
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
        afterHash: `${referral.referralNumber}:${referral.type}:${referral.urgency}`,
      });
      return referral;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ referral: result }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
