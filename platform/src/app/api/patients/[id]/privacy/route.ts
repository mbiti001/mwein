import { z } from "zod";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError, privateJson } from "@/lib/http";
import { normalizeName } from "@/lib/security";
import {
  canTransitionDataSubjectRequest,
  consentMethods,
  consentTypes,
  dataSubjectRequestStatuses,
  dataSubjectRequestTypes,
  type DataSubjectRequestStatus,
} from "@/lib/privacy";

const recordConsentSchema = z.object({
  action: z.literal("RECORD_CONSENT"),
  type: z.enum(consentTypes),
  granted: z.boolean(),
  noticeVersion: z.string().trim().min(3).max(80),
  method: z.enum(consentMethods),
  evidenceReference: z.string().trim().min(3).max(800).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
const withdrawConsentSchema = z.object({
  action: z.literal("WITHDRAW_CONSENT"),
  consentId: z.uuid(),
  reason: z.string().trim().min(5).max(500),
});
const createRequestSchema = z.object({
  action: z.literal("CREATE_REQUEST"),
  type: z.enum(dataSubjectRequestTypes),
  details: z.string().trim().min(10).max(2000),
  dueAt: z.iso.datetime({ offset: true }),
}).superRefine((value, context) => {
  if (new Date(value.dueAt) <= new Date()) context.addIssue({ code: "custom", path: ["dueAt"], message: "Due date must be in the future" });
});
const updateRequestSchema = z.object({
  action: z.literal("UPDATE_REQUEST"),
  requestId: z.uuid(),
  status: z.enum(dataSubjectRequestStatuses),
  resolution: z.string().trim().min(5).max(2000).optional(),
  denialReason: z.string().trim().min(5).max(1000).optional(),
  evidenceReference: z.string().trim().min(3).max(800).optional(),
}).superRefine((value, context) => {
  if (value.status === "COMPLETED" && (!value.resolution || !value.evidenceReference))
    context.addIssue({ code: "custom", path: ["resolution"], message: "Completion requires a resolution and retained evidence reference" });
  if (value.status === "DENIED" && !value.denialReason)
    context.addIssue({ code: "custom", path: ["denialReason"], message: "Denial requires a reason" });
});
const correctionSchema = z.object({
  action: z.literal("APPLY_DEMOGRAPHIC_CORRECTION"),
  requestId: z.uuid(),
  reason: z.string().trim().min(10).max(1000),
  changes: z.object({
    givenName: z.string().trim().min(1).max(60).optional(),
    middleName: z.string().trim().max(60).nullable().optional(),
    familyName: z.string().trim().min(1).max(60).optional(),
    dateOfBirth: z.iso.date().nullable().optional(),
    estimatedAgeYears: z.number().int().min(0).max(130).nullable().optional(),
    sexAtBirth: z.enum(["FEMALE", "MALE", "INTERSEX", "UNKNOWN"]).optional(),
    gender: z.string().trim().max(80).nullable().optional(),
    preferredLanguage: z.enum(["English", "Kiswahili"]).optional(),
    bloodGroup: z.string().trim().max(10).nullable().optional(),
    occupation: z.string().trim().max(120).nullable().optional(),
    maritalStatus: z.string().trim().max(80).nullable().optional(),
    disabilityStatus: z.string().trim().max(160).nullable().optional(),
  }).refine((changes) => Object.keys(changes).length > 0, "At least one correction is required"),
});
const inputSchema = z.union([recordConsentSchema, withdrawConsentSchema, createRequestSchema, updateRequestSchema, correctionSchema]);

async function patientInFacility(id: string, facilityId: string) {
  const patient = await db.patient.findFirst({ where: { id, facilityId }, select: { id: true, patientNumber: true, fullName: true } });
  if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
  return patient;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("privacy.manage");
    const { id } = await params;
    const patient = await patientInFacility(id, user.facilityId);
    const result = await db.$transaction(async (tx) => {
      const [consents, requests] = await Promise.all([
        tx.consent.findMany({ where: { patientId: id }, orderBy: { recordedAt: "desc" } }),
        tx.dataSubjectRequest.findMany({ where: { patientId: id, facilityId: user.facilityId }, include: { createdBy: { select: { displayName: true } }, updatedBy: { select: { displayName: true } } }, orderBy: { requestedAt: "desc" } }),
      ]);
      await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "PATIENT_PRIVACY_RECORD_ACCESSED", entityType: "Patient", entityId: id, afterHash: `${consents.length}:${requests.length}` });
      return { consents, requests };
    });
    return privateJson({ patient, ...result });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("privacy.manage");
    const { id } = await params;
    await patientInFacility(id, user.facilityId);
    const input = inputSchema.parse(await request.json());
    const record = await db.$transaction(async (tx) => {
      if (input.action === "RECORD_CONSENT") {
        const now = new Date();
        if (input.expiresAt && new Date(input.expiresAt) <= now) throw Object.assign(new Error("Consent expiry must be in the future"), { status: 422 });
        await tx.consent.updateMany({ where: { patientId: id, type: input.type, withdrawnAt: null }, data: { withdrawnAt: now, withdrawnById: user.id, withdrawalReason: "Superseded by a newer consent decision" } });
        const consent = await tx.consent.create({ data: { patientId: id, type: input.type, granted: input.granted, noticeVersion: input.noticeVersion, method: input.method, evidenceReference: input.evidenceReference, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, recordedById: user.id } });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "PATIENT_CONSENT_RECORDED", entityType: "Consent", entityId: consent.id, afterHash: `${consent.type}:${consent.granted}:${consent.noticeVersion}:${consent.method}` });
        return consent;
      }
      if (input.action === "WITHDRAW_CONSENT") {
        const current = await tx.consent.findFirst({ where: { id: input.consentId, patientId: id } });
        if (!current) throw Object.assign(new Error("Consent record not found"), { status: 404 });
        if (current.withdrawnAt) throw Object.assign(new Error("Consent is already withdrawn"), { status: 409 });
        const consent = await tx.consent.update({ where: { id: current.id }, data: { withdrawnAt: new Date(), withdrawnById: user.id, withdrawalReason: input.reason } });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "PATIENT_CONSENT_WITHDRAWN", entityType: "Consent", entityId: consent.id, reason: input.reason, beforeHash: `${current.type}:${current.granted}`, afterHash: "WITHDRAWN" });
        return consent;
      }
      if (input.action === "CREATE_REQUEST") {
        const dataRequest = await tx.dataSubjectRequest.create({ data: { facilityId: user.facilityId, patientId: id, type: input.type, details: input.details, dueAt: new Date(input.dueAt), createdById: user.id, updatedById: user.id } });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "DATA_SUBJECT_REQUEST_RECORDED", entityType: "DataSubjectRequest", entityId: dataRequest.id, afterHash: `${dataRequest.type}:${dataRequest.status}:${dataRequest.dueAt.toISOString()}` });
        return dataRequest;
      }
      if (input.action === "APPLY_DEMOGRAPHIC_CORRECTION") {
        const dataRequest = await tx.dataSubjectRequest.findFirst({ where: { id: input.requestId, patientId: id, facilityId: user.facilityId } });
        if (!dataRequest) throw Object.assign(new Error("Data-subject request not found"), { status: 404 });
        if (dataRequest.type !== "CORRECTION" || dataRequest.status !== "IN_REVIEW") throw Object.assign(new Error("Only an in-review correction request can apply demographic changes"), { status: 409 });
        const current = await tx.patient.findUniqueOrThrow({ where: { id }, select: { givenName: true, middleName: true, familyName: true, fullName: true, dateOfBirth: true, estimatedAgeYears: true, sexAtBirth: true, gender: true, preferredLanguage: true, bloodGroup: true, occupation: true, maritalStatus: true, disabilityStatus: true } });
        const changes = { ...input.changes };
        if (changes.dateOfBirth) changes.estimatedAgeYears = null;
        if (changes.estimatedAgeYears !== undefined && changes.estimatedAgeYears !== null) changes.dateOfBirth = null;
        const givenName = changes.givenName ?? current.givenName;
        const middleName = changes.middleName === undefined ? current.middleName : changes.middleName;
        const familyName = changes.familyName ?? current.familyName;
        const namesChanged = changes.givenName !== undefined || changes.middleName !== undefined || changes.familyName !== undefined;
        const fullName = namesChanged ? [givenName, middleName, familyName].filter(Boolean).join(" ") : current.fullName;
        const updated = await tx.patient.update({ where: { id }, data: { ...changes, ...(namesChanged ? { fullName, normalizedName: normalizeName(fullName) } : {}) } });
        const audit = await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "PATIENT_DEMOGRAPHICS_CORRECTED", entityType: "Patient", entityId: id, reason: input.reason, beforeHash: auditValueFingerprint(current), afterHash: auditValueFingerprint(updated) });
        const completed = await tx.dataSubjectRequest.update({ where: { id: dataRequest.id }, data: { status: "COMPLETED", completedAt: new Date(), resolution: "Approved demographic correction applied to the patient record", evidenceReference: `audit:${audit.id}`, updatedById: user.id } });
        return completed;
      }
      const current = await tx.dataSubjectRequest.findFirst({ where: { id: input.requestId, patientId: id, facilityId: user.facilityId } });
      if (!current) throw Object.assign(new Error("Data-subject request not found"), { status: 404 });
      if (!canTransitionDataSubjectRequest(current.status as DataSubjectRequestStatus, input.status))
        throw Object.assign(new Error(`Request cannot move from ${current.status} to ${input.status}`), { status: 409 });
      const updated = await tx.dataSubjectRequest.update({ where: { id: current.id }, data: { status: input.status, resolution: input.resolution, denialReason: input.denialReason, evidenceReference: input.evidenceReference, completedAt: ["COMPLETED", "DENIED", "CANCELLED"].includes(input.status) ? new Date() : null, updatedById: user.id } });
      await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "DATA_SUBJECT_REQUEST_UPDATED", entityType: "DataSubjectRequest", entityId: updated.id, beforeHash: current.status, afterHash: updated.status });
      return updated;
    });
    return privateJson({ record });
  } catch (error) { return apiError(error); }
}
