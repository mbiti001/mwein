import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { apiError, privateJson } from "@/lib/http";
import { assertLocalReportTransition, localReportContract, localReportHash, localReportMonth, localReportPayload, requireCompleteLocalReport } from "@/lib/local-reports";

const createSchema = z.object({ month: localReportMonth, payload: localReportPayload }).strict();
const changeSchema = z.object({
  id: z.uuid(), version: z.number().int().positive(),
  action: z.enum(["SAVE", "REQUEST_REVIEW", "RETURN", "APPROVE", "CORRECT"]),
  reason: z.string().trim().min(3).max(500),
  payload: localReportPayload.optional(),
}).strict().superRefine((value, context) => {
  if ((value.action === "SAVE") !== (value.payload !== undefined)) context.addIssue({ code: "custom", message: "Only saving a draft accepts a payload, and a save requires it", path: ["payload"] });
});
const includes = { preparedBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } }, successor: { select: { id: true } } };
const descriptor = { contract: localReportContract, datasetStatus: "UNCONFIGURED", submissionStatus: "NOT_SUBMITTED" };

export async function GET(request: Request) {
  try {
    const user = await requirePermission("reports.clinical");
    const month = localReportMonth.parse(new URL(request.url).searchParams.get("month"));
    const reports = await db.localReportRevision.findMany({ where: { facilityId: user.facilityId, month }, include: includes, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101 });
    const result = { ...descriptor, reports: reports.slice(0, 100), truncated: reports.length > 100 };
    await recordDisclosure(user, "LOCAL_REPORT", result.reports.map(report => report.id), result);
    return privateJson(result);
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requirePermission("reports.prepare");
    const input = createSchema.parse(await request.json());
    const report = await db.$transaction(async tx => {
      const record = await tx.localReportRevision.create({ data: { ...input, facilityId: user.facilityId, familyId: randomUUID(), preparedById: user.id, contributorIds: [user.id], payloadHash: localReportHash(input.month, input.payload) }, include: includes });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "LOCAL_REPORT_CREATED", entityType: "LocalReportRevision", entityId: record.id, afterHash: auditValueFingerprint(record) });
      return record;
    });
    return privateJson({ ...descriptor, report }, { status: 201 });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    // Authenticate before parsing potentially sensitive request bodies.
    await requirePermission("reports.clinical");
    const input = changeSchema.parse(await request.json());
    const user = await requirePermission(["APPROVE", "RETURN"].includes(input.action) ? "reports.review" : "reports.prepare");
    const report = await db.$transaction(async tx => {
      const previous = await tx.localReportRevision.findFirst({ where: { id: input.id, facilityId: user.facilityId } });
      if (!previous) throw Object.assign(new Error("Report not found"), { status: 404 });
      if (previous.version !== input.version) throw Object.assign(new Error("Report changed. Refresh before continuing."), { status: 409 });
      assertLocalReportTransition(previous.status, input.action, previous.contributorIds, user.id);
      const payload = localReportPayload.parse(previous.payload);
      if (localReportHash(previous.month, payload) !== previous.payloadHash) throw new Error("Report integrity check failed");
      if (["REQUEST_REVIEW", "APPROVE"].includes(input.action)) requireCompleteLocalReport(payload);
      let record;
      if (input.action === "CORRECT") {
        record = await tx.localReportRevision.create({ data: {
          facilityId: user.facilityId, familyId: previous.familyId, revision: previous.revision + 1, previousId: previous.id,
          month: previous.month, payload, payloadHash: previous.payloadHash, preparedById: user.id,
          contributorIds: [...new Set([...previous.contributorIds, user.id])], correctionReason: input.reason,
        }, include: includes });
      } else {
        const data: Prisma.LocalReportRevisionUncheckedUpdateManyInput = { version: { increment: 1 } };
        if (input.action === "SAVE") {
          data.payload = input.payload!; data.payloadHash = localReportHash(previous.month, input.payload!);
          data.contributorIds = [...new Set([...previous.contributorIds, user.id])];
          data.reviewedById = null; data.reviewedAt = null; data.reviewNote = null;
        } else if (input.action === "REQUEST_REVIEW") data.status = "IN_REVIEW";
        else {
          data.status = input.action === "APPROVE" ? "APPROVED" : "DRAFT";
          data.reviewedById = user.id; data.reviewedAt = new Date(); data.reviewNote = input.reason;
        }
        const changed = await tx.localReportRevision.updateMany({ where: { id: previous.id, facilityId: user.facilityId, version: input.version, status: previous.status }, data });
        if (changed.count !== 1) throw Object.assign(new Error("Report changed. Refresh before continuing."), { status: 409 });
        record = await tx.localReportRevision.findUniqueOrThrow({ where: { id: previous.id }, include: includes });
      }
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: `LOCAL_REPORT_${input.action}`, entityType: "LocalReportRevision", entityId: record.id, reason: input.reason, beforeHash: auditValueFingerprint(previous), afterHash: auditValueFingerprint({ record, reason: input.reason }) });
      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return privateJson({ ...descriptor, report });
  } catch (error) { return apiError(error); }
}
