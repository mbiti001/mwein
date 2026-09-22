import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { normalizeName, hashToken } from "@/lib/security";
import { identityInput, identitySnapshot, canReverseIdentity, type IdentityDemographics } from "@/lib/patient-identity";

async function actor() {
  const user = await requirePermission("patient.create");
  if (!user.permissions.includes("patient.read")) throw Object.assign(new Error("Patient record access is required"), { status: 403 });
  return user;
}
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await actor(); const { id } = await context.params;
    if (!await db.patient.findFirst({ where: { id, facilityId: user.facilityId, active: true }, select: { id: true } })) throw Object.assign(new Error("Patient not found"), { status: 404 });
    const history = await db.patientIdentityReconciliation.findMany({ where: { patientId: id, facilityId: user.facilityId }, orderBy: [{ reconciledAt: "desc" }, { id: "desc" }], take: 30, select: { id: true, previousStatus: true, resultingStatus: true, reason: true, reconciledAt: true, reversedAt: true, previousData: true } });
    await db.$transaction(tx => appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "PATIENT_IDENTITY_HISTORY_VIEWED", entityType: "Patient", entityId: id }));
    return NextResponse.json({ history: history.map(({ previousData, ...item }, index) => ({ ...item, reversible: index === 0 && Boolean(previousData) && !item.reversedAt })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await actor(); const { id } = await context.params; const body = await request.json();
    const reversal = body.action === "REVERSE" ? z.object({ recordId: z.uuid(), reason: z.string().trim().min(10).max(1000) }).parse(body) : null;
    const input = reversal ? null : identityInput.parse(body);
    const result = await db.$transaction(async tx => {
      const current = await tx.patient.findFirst({ where: { id, facilityId: user.facilityId, active: true } });
      if (!current) throw Object.assign(new Error("Patient not found"), { status: 404 });
      if (reversal) {
        const record = await tx.patientIdentityReconciliation.findFirst({ where: { patientId: id, facilityId: user.facilityId }, orderBy: [{ reconciledAt: "desc" }, { id: "desc" }] });
        if (!record || record.id !== reversal.recordId || record.reversedAt || !record.previousData || !record.resultingData) throw Object.assign(new Error("Only the latest unreversed correction with a snapshot can be reversed"), { status: 409 });
        const resultData = record.resultingData as { demographics: Prisma.JsonValue; addedIdentifierId: string | null };
        if (!canReverseIdentity(current, resultData.demographics)) throw Object.assign(new Error("Identity changed after this correction; a new reviewed correction is required"), { status: 409 });
        const previous = record.previousData as unknown as IdentityDemographics;
        const restored = await tx.patient.update({ where: { id }, data: { ...previous, sexAtBirth: previous.sexAtBirth as "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN", dateOfBirth: previous.dateOfBirth ? new Date(previous.dateOfBirth) : null } });
        // The snapshot retains the identifier provenance; release only the identifier added by this correction.
        if (resultData.addedIdentifierId) await tx.patientIdentifier.deleteMany({ where: { id: resultData.addedIdentifierId, patientId: id } });
        await tx.patientIdentityReconciliation.update({ where: { id: record.id }, data: { reversedAt: new Date() } });
        await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "PATIENT_IDENTITY_CORRECTION_REVERSED", entityType: "Patient", entityId: id, reason: reversal.reason, beforeHash: hashToken(JSON.stringify(identitySnapshot(current))), afterHash: hashToken(JSON.stringify(identitySnapshot(restored))) });
        return { patient: restored };
      }
      const value = input!;
      const duplicate = await tx.patientIdentifier.findUnique({ where: { type_value: { type: value.identifierType, value: value.identifierValue } } });
      if (duplicate && duplicate.patientId !== id) throw Object.assign(new Error("Identifier already assigned. Review the duplicate with the records officer; records were not merged or changed."), { status: 409 });
      const fullName = [value.givenName, value.middleName, value.familyName].filter(Boolean).join(" ");
      const patient = await tx.patient.update({ where: { id }, data: {
        givenName: value.givenName, middleName: value.middleName || null, familyName: value.familyName, fullName, normalizedName: normalizeName(fullName), dateOfBirth: value.dateOfBirth ? new Date(value.dateOfBirth) : null, estimatedAgeYears: value.dateOfBirth ? null : value.estimatedAgeYears, sexAtBirth: value.sexAtBirth, identityStatus: "DOCUMENTED",
        // Local evidence does not remove privacy restrictions or establish national verification.
      } });
      const identifier = duplicate || await tx.patientIdentifier.create({ data: { patientId: id, type: value.identifierType, value: value.identifierValue, issuer: value.issuer } });
      const reconciliation = await tx.patientIdentityReconciliation.create({ data: { facilityId: user.facilityId, patientId: id, previousStatus: current.identityStatus, resultingStatus: patient.identityStatus, evidenceType: value.evidenceType, evidenceReference: value.evidenceReference, reason: value.reason, reconciledById: user.id,
        previousData: identitySnapshot(current), resultingData: { demographics: identitySnapshot(patient), addedIdentifierId: duplicate ? null : identifier.id, identifier: { type: identifier.type, value: identifier.value, issuer: identifier.issuer } } } });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "PATIENT_IDENTITY_RECONCILED", entityType: "Patient", entityId: id, reason: value.reason, beforeHash: hashToken(JSON.stringify(identitySnapshot(current))), afterHash: hashToken(JSON.stringify(identitySnapshot(patient))) });
      return { patient, reconciliation };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
