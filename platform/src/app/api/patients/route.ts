import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { normalizeName } from "@/lib/security";
import { patientNumber, patientRegistrationSchema } from "@/lib/domain";

export async function GET(request: Request) {
  try {
    const user = await requirePermission("patient.read");
    const query = new URL(request.url).searchParams.get("q")?.trim() || "";
    const canRegister = user.permissions.includes("patient.create");
    const canViewContactDetails = canRegister || user.permissions.includes("encounter.write");
    const canViewAllergies = user.permissions.some((permission) => ["encounter.write", "pharmacy.dispense", "triage.write"].includes(permission));
    const patients = await db.patient.findMany({
      where: {
        facilityId: user.facilityId,
        active: true,
        ...(query ? {
          OR: [
            { fullName: { contains: query, mode: "insensitive" } },
            { patientNumber: { contains: query, mode: "insensitive" } },
            ...(canViewContactDetails ? [
              { contacts: { some: { value: { contains: query } } } },
              { identifiers: { some: { value: { contains: query, mode: "insensitive" as const } } } },
            ] : [])
          ]
        } : {})
      },
      select: {
        id: true,
        patientNumber: true,
        fullName: true,
        dateOfBirth: true,
        estimatedAgeYears: true,
        sexAtBirth: true,
        ...(canViewContactDetails ? {
          givenName: true,
          middleName: true,
          familyName: true,
          preferredLanguage: true,
          identifiers: true,
          contacts: true,
        } : {}),
        ...(canRegister ? {
          addresses: { where: { primary: true }, take: 1 },
        } : {}),
        ...(canViewAllergies ? { allergies: { where: { active: true } } } : {}),
      },
      orderBy: { updatedAt: "desc" }, take: 50
    });
    await recordClinicalAccess(user, "PATIENT_SEARCH", patients.map(({ id }) => ({ type: "Patient", id })));
    return NextResponse.json({ patients }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("patient.create");
    const input = patientRegistrationSchema.parse(await request.json());
    const statedName = input.fullName || [input.givenName, input.middleName, input.familyName].filter(Boolean).join(" ");
    const normalizedName = statedName ? normalizeName(statedName) : "";
    // A phone is a contact route, not a unique identity. Siblings and dependants
    // may legitimately share a representative's number.
    const identifiers = [...(input.nationalId ? [{ type: "NATIONAL_ID", value: input.nationalId }] : []), ...(input.shaNumber ? [{ type: "SHA", value: input.shaNumber }] : [])];
    const duplicateSignals = [
      ...(identifiers.length ? [{ identifiers: { some: { OR: identifiers.map(item => ({ type: item.type, value: item.value })) } } }] : []),
      ...(normalizedName && input.dateOfBirth ? [{ AND: [{ normalizedName }, { dateOfBirth: new Date(input.dateOfBirth) }] }] : []),
    ];
    const duplicate = duplicateSignals.length ? await db.patient.findFirst({ where: { facilityId: user.facilityId, active: true, OR: duplicateSignals }, select: { id: true, patientNumber: true, fullName: true } }) : null;
    if (duplicate) return NextResponse.json({ error: "A strong identity match requires duplicate review", duplicate }, { status: 409 });
    const created = await db.$transaction(async tx => {
      const facility = await tx.facility.findUniqueOrThrow({ where: { id: user.facilityId } });
      const year = new Date().getFullYear();
      const sequence = await tx.referenceSequence.upsert({ where: { facilityId_kind_year: { facilityId: user.facilityId, kind: "PATIENT", year } }, update: { nextValue: { increment: 1 } }, create: { facilityId: user.facilityId, kind: "PATIENT", year, nextValue: 2 } });
      const assigned = sequence.nextValue - 1n;
      const assignedNumber = patientNumber(facility.code, year, assigned);
      const fullName = input.registrationMode === "EMERGENCY_UNKNOWN" ? `Unidentified patient ${assignedNumber}` : statedName;
      const patient = await tx.patient.create({ data: {
        facilityId: user.facilityId, patientNumber: assignedNumber, givenName: input.givenName, middleName: input.middleName, familyName: input.familyName, fullName, normalizedName: normalizeName(fullName),
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null, estimatedAgeYears: input.estimatedAgeYears, sexAtBirth: input.sexAtBirth, preferredLanguage: input.preferredLanguage,
        registrationMode: input.registrationMode,
        identityStatus: input.registrationMode === "EMERGENCY_UNKNOWN" ? "UNIDENTIFIED" : input.registrationMode === "GUARDIAN_ASSISTED" ? "REPRESENTATIVE_ASSERTED" : "ASSERTED",
        restricted: input.registrationMode === "EMERGENCY_UNKNOWN",
        ...(identifiers.length ? { identifiers: { create: identifiers } } : {}),
        ...((input.phone || input.alternativePhone) ? { contacts: { create: [
          ...(input.phone ? [{ type: "PHONE", value: input.phone, primary: true, relationship: input.registrationMode === "GUARDIAN_ASSISTED" ? input.representativeRelationship : undefined }] : []),
          ...(input.alternativePhone ? [{ type: "ALTERNATIVE_PHONE", value: input.alternativePhone, primary: false }] : []),
        ] } } : {}),
        ...(input.county && input.subcounty ? { addresses: { create: { county: input.county, subcounty: input.subcounty, ward: input.ward, village: input.village } } } : {}),
        consents: { create: [
          { type: "TREATMENT", granted: input.treatmentConsent, recordedById: user.id, noticeVersion: input.noticeVersion, lawfulBasis: input.lawfulBasis, representativeName: input.representativeName, representativeRelationship: input.representativeRelationship, reason: input.emergencyReason },
          { type: "ELECTRONIC_RECORD", granted: input.electronicRecordConsent, recordedById: user.id, noticeVersion: input.noticeVersion, lawfulBasis: input.lawfulBasis, representativeName: input.representativeName, representativeRelationship: input.representativeRelationship, reason: input.emergencyReason },
          { type: "MESSAGING", granted: input.messagingConsent, recordedById: user.id, noticeVersion: input.noticeVersion, lawfulBasis: "CONSENT", representativeName: input.representativeName, representativeRelationship: input.representativeRelationship },
        ] }
      }, include: { identifiers: true, contacts: true, addresses: true } });
      await appendAudit(tx, { userId: user.id, action: "PATIENT_REGISTERED", entityType: "Patient", entityId: patient.id, afterHash: patient.patientNumber, reason: JSON.stringify({ registrationMode: input.registrationMode, identityStatus: patient.identityStatus }) });
      return patient;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ patient: created }, { status: 201 });
  } catch (error) { return apiError(error); }
}
