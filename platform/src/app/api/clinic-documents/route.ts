import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { apiError, privateJson } from "@/lib/http";
import { documentKindSchema, documentDefinitions, parseDocumentPayload, assertDocumentEditable } from "@/lib/clinic-documents";
import { clinicDocumentHash } from "@/lib/clinic-document-integrity";

const include = { successor: { select: { id: true, status: true, reference: true } } };
const create = z.object({ kind: documentKindSchema, visitId: z.uuid().nullable(), payload: z.unknown() }).strict();
const change = z.object({ id: z.uuid(), kind: documentKindSchema, version: z.number().int().positive(), action: z.enum(["SAVE", "SIGN", "CORRECT"]), payload: z.unknown().optional(), attested: z.literal(true).optional(), registration: z.string().trim().max(120).optional(), reason: z.string().trim().min(10).max(500).optional() }).strict();
function serial(record: any) {
  if (record.status === "SIGNED" && clinicDocumentHash(record) !== record.contentHash) throw new Error("Document integrity check failed");
  // Session identity is evidence for administrators, not a public document field.
  const { signerSessionId: _session, ...safe } = record;
  return safe;
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kind = documentKindSchema.parse(url.searchParams.get("kind"));
    const user = await requirePermission(documentDefinitions[kind].permission);
    const query = z.string().trim().max(120).parse(url.searchParams.get("q") || "");
    if (url.searchParams.get("visits") === "1") {
      if (kind === "DELIVERY") return privateJson({ visits: [] });
      const visits = await db.visit.findMany({ where: { facilityId: user.facilityId, status: { not: "CANCELLED" }, ...(query ? { OR: [{ visitNumber: { contains: query, mode: "insensitive" } }, { patient: { fullName: { contains: query, mode: "insensitive" } } }, { patient: { patientNumber: { contains: query, mode: "insensitive" } } }] } : {}) }, select: { id: true, visitNumber: true, arrivedAt: true, patient: { select: { fullName: true, patientNumber: true } } }, orderBy: { arrivedAt: "desc" }, take: 30 });
      await recordDisclosure(user, "CLINIC_DOCUMENT", visits.map(v => v.id));
      return privateJson({ visits });
    }
    const records = await db.clinicDocument.findMany({ where: { facilityId: user.facilityId, kind, ...(query ? { reference: { contains: query, mode: "insensitive" } } : {}) }, include, orderBy: { createdAt: "desc" }, take: 101 });
    const documents = records.slice(0, 100).map(serial);
    await recordDisclosure(user, "CLINIC_DOCUMENT", documents.map(d => d.id));
    return privateJson({ documents, truncated: records.length > 100 });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const input = create.parse(await request.json());
    const user = await requirePermission(documentDefinitions[input.kind].permission);
    const payload = parseDocumentPayload(input.kind, input.payload);
    const document = await db.$transaction(async tx => {
      const visit = input.visitId ? await tx.visit.findFirst({ where: { id: input.visitId, facilityId: user.facilityId, status: { not: "CANCELLED" } }, select: { id: true, visitNumber: true, patient: { select: { fullName: true, patientNumber: true } } } }) : null;
      if (input.kind !== "DELIVERY" && !visit) throw Object.assign(new Error("Select a patient visit in your facility"), { status: 422 });
      if (input.kind === "DELIVERY" && input.visitId) throw Object.assign(new Error("Goods delivery notes must not include a patient visit"), { status: 422 });
      const id = randomUUID();
      const record = await tx.clinicDocument.create({ data: { id, facilityId: user.facilityId, visitId: visit?.id || null, kind: input.kind, reference: `${user.facility.code}-${input.kind}-${id}`, payload, context: { facilityName: user.facility.name, facilityCode: user.facility.code, timezone: user.facility.timezone, ...(visit ? { visitNumber: visit.visitNumber, patientName: visit.patient.fullName, patientNumber: visit.patient.patientNumber } : {}) }, authorId: user.id, signerRoles: [] }, include });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "CLINIC_DOCUMENT_CREATED", entityType: "ClinicDocument", entityId: record.id, afterHash: auditValueFingerprint(record) });
      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return privateJson({ document: serial(document) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const input = change.parse(await request.json());
    const user = await requirePermission(documentDefinitions[input.kind].permission);
    const document = await db.$transaction(async tx => {
      const previous = await tx.clinicDocument.findFirst({ where: { id: input.id, facilityId: user.facilityId, kind: input.kind } });
      if (!previous) throw Object.assign(new Error("Document not found"), { status: 404 });
      if (previous.version !== input.version) throw Object.assign(new Error("Document changed. Reload before continuing."), { status: 409 });
      let record;
      if (input.action === "CORRECT") {
        if (previous.status !== "SIGNED" || !input.reason) throw Object.assign(new Error("Corrections require a signed document and a reason of at least 10 characters"), { status: 422 });
        serial(previous);
        const id = randomUUID();
        record = await tx.clinicDocument.create({ data: { id, facilityId: user.facilityId, visitId: previous.visitId, kind: previous.kind, reference: `${user.facility.code}-${previous.kind}-${id}`, revision: previous.revision + 1, previousId: previous.id, correctionReason: input.reason, payload: previous.payload as Prisma.InputJsonValue, context: previous.context as Prisma.InputJsonValue, authorId: user.id, signerRoles: [] }, include });
      } else {
        assertDocumentEditable(previous.status, previous.version, input.version);
        const data: Prisma.ClinicDocumentUpdateManyMutationInput = { version: { increment: 1 } };
        if (input.action === "SAVE") {
          data.payload = parseDocumentPayload(input.kind, input.payload);
        } else {
          if (!input.attested) throw Object.assign(new Error("Confirm that you reviewed and authorize this document"), { status: 422 });
          if (input.payload !== undefined) throw Object.assign(new Error("Save changes before signing"), { status: 422 });
          parseDocumentPayload(input.kind, previous.payload, true);
          if (documentDefinitions[input.kind].clinical && !input.registration?.trim()) throw Object.assign(new Error("Enter your professional registration number"), { status: 422 });
          const signature = { signedById: user.id, signedAt: new Date(), signerName: user.displayName, signerRoles: user.roles, signerRegistration: input.registration || null, signerSessionId: user.sessionId };
          Object.assign(data, signature, { status: "SIGNED", contentHash: clinicDocumentHash({ ...previous, ...signature }) });
        }
        const changed = await tx.clinicDocument.updateMany({ where: { id: previous.id, facilityId: user.facilityId, version: input.version, status: "DRAFT" }, data });
        if (changed.count !== 1) throw Object.assign(new Error("Document changed. Reload before continuing."), { status: 409 });
        record = await tx.clinicDocument.findUniqueOrThrow({ where: { id: previous.id }, include });
      }
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: `CLINIC_DOCUMENT_${input.action}`, entityType: "ClinicDocument", entityId: record.id, reason: input.reason, beforeHash: auditValueFingerprint(previous), afterHash: auditValueFingerprint(record) });
      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return privateJson({ document: serial(document) });
  } catch (error) { return apiError(error); }
}
