import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { normalizeName } from "@/lib/security";
import { patientNumber, patientRegistrationSchema } from "@/lib/domain";

export async function GET(request: Request) {
  try {
    const user = await requirePermission("patient.read");
    const query = new URL(request.url).searchParams.get("q")?.trim() || "";
    const patients = await db.patient.findMany({
      where: {
        facilityId: user.facilityId,
        active: true,
        ...(query ? {
          OR: [
            { fullName: { contains: query, mode: "insensitive" } },
            { patientNumber: { contains: query, mode: "insensitive" } },
            { contacts: { some: { value: { contains: query } } } },
            { identifiers: { some: { value: { contains: query, mode: "insensitive" } } } }
          ]
        } : {})
      },
      include: { identifiers: true, contacts: true, addresses: { where: { primary: true }, take: 1 }, allergies: { where: { active: true } } },
      orderBy: { updatedAt: "desc" }, take: 50
    });
    return NextResponse.json({ patients });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("patient.create");
    const input = patientRegistrationSchema.parse(await request.json());
    const fullName = input.fullName || [input.givenName, input.middleName, input.familyName].filter(Boolean).join(" ");
    const normalizedName = normalizeName(fullName);
    const identifiers = [{ type: "PHONE", value: input.phone }, ...(input.nationalId ? [{ type: "NATIONAL_ID", value: input.nationalId }] : []), ...(input.shaNumber ? [{ type: "SHA", value: input.shaNumber }] : [])];
    const duplicate = await db.patient.findFirst({ where: { facilityId: user.facilityId, active: true, OR: [{ identifiers: { some: { OR: identifiers.map(item => ({ type: item.type, value: item.value })) } } }, { AND: [{ normalizedName }, ...(input.dateOfBirth ? [{ dateOfBirth: new Date(input.dateOfBirth) }] : [])] }] }, select: { id: true, patientNumber: true, fullName: true } });
    if (duplicate) return NextResponse.json({ error: "Possible duplicate patient found", duplicate }, { status: 409 });
    const created = await db.$transaction(async tx => {
      const facility = await tx.facility.findUniqueOrThrow({ where: { id: user.facilityId } });
      const year = new Date().getFullYear();
      const sequence = await tx.referenceSequence.upsert({ where: { facilityId_kind_year: { facilityId: user.facilityId, kind: "PATIENT", year } }, update: { nextValue: { increment: 1 } }, create: { facilityId: user.facilityId, kind: "PATIENT", year, nextValue: 2 } });
      const assigned = sequence.nextValue - 1n;
      const patient = await tx.patient.create({ data: {
        facilityId: user.facilityId, patientNumber: patientNumber(facility.code, year, assigned), givenName: input.givenName, middleName: input.middleName, familyName: input.familyName, fullName, normalizedName,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null, estimatedAgeYears: input.estimatedAgeYears, sexAtBirth: input.sexAtBirth, preferredLanguage: input.preferredLanguage,
        identifiers: { create: identifiers }, contacts: { create: [{ type: "PHONE", value: input.phone, primary: true }, ...(input.alternativePhone ? [{ type: "ALTERNATIVE_PHONE", value: input.alternativePhone }] : [])] },
        addresses: { create: { county: input.county, subcounty: input.subcounty, ward: input.ward, village: input.village } },
        consents: { create: [{ type: "TREATMENT", granted: input.treatmentConsent, recordedById: user.id }, { type: "ELECTRONIC_RECORD", granted: input.electronicRecordConsent, recordedById: user.id }, { type: "MESSAGING", granted: input.messagingConsent, recordedById: user.id }] }
      }, include: { identifiers: true, contacts: true, addresses: true } });
      await appendAudit(tx, { userId: user.id, action: "PATIENT_REGISTERED", entityType: "Patient", entityId: patient.id, afterHash: patient.patientNumber });
      return patient;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ patient: created }, { status: 201 });
  } catch (error) { return apiError(error); }
}
