import { z } from "zod";
import { auditValueFingerprint } from "./audit";

const pastTime = z.iso.datetime({ offset: true }).refine(value => new Date(value).getTime() <= Date.now(), "Time cannot be in the future");
export const surveillanceDetails = z.object({
  kind: z.enum(["CASE", "EVENT"]),
  patientId: z.uuid().nullable(),
  concern: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(3000),
  location: z.string().trim().max(300),
  detectedAt: pastTime,
  onsetAt: pastTime.nullable(),
  priority: z.enum(["UNASSESSED", "URGENT", "ROUTINE"]),
}).strict().superRefine((data, ctx) => {
  if (data.kind === "EVENT" && data.patientId) ctx.addIssue({ code: "custom", message: "An event is not linked to one patient; use a case record for patient-specific details", path: ["patientId"] });
});
export type SurveillanceDetails = z.infer<typeof surveillanceDetails>;
export const manualNotification = z.object({
  notifiedAt: pastTime,
  recipient: z.string().trim().min(3).max(160),
  channel: z.enum(["PHONE", "PAPER", "OTHER_APPROVED_CHANNEL"]),
  outcome: z.enum(["ATTEMPTED", "REPORTED_DELIVERED"]),
  evidenceReference: z.string().trim().min(3).max(500),
}).strict();
export const manualAcknowledgement = z.object({
  notificationId: z.uuid(), acknowledgedAt: pastTime,
  recipient: z.string().trim().min(3).max(160),
  evidenceReference: z.string().trim().min(3).max(500),
}).strict();
const baseChange = { id: z.uuid(), version: z.number().int().positive(), reason: z.string().trim().min(3).max(1000) };
export const surveillanceChange = z.discriminatedUnion("action", [
  z.object({ ...baseChange, action: z.literal("UPDATE"), details: surveillanceDetails }).strict(),
  z.object({ ...baseChange, action: z.enum(["REVIEW", "CLOSE", "REOPEN"]) }).strict(),
  z.object({ ...baseChange, action: z.literal("DUPLICATE"), duplicateOfId: z.uuid() }).strict(),
  z.object({ ...baseChange, action: z.literal("NOTIFY"), notification: manualNotification }).strict(),
  z.object({ ...baseChange, action: z.literal("ACKNOWLEDGE"), acknowledgement: manualAcknowledgement }).strict(),
  z.object({ ...baseChange, action: z.literal("ANNOTATE"), entryId: z.uuid() }).strict(),
]);
export function assertSurveillanceAction(status: string, action: string, priority: string) {
  const allowed = action === "UPDATE" ? status !== "CLOSED"
    : action === "REVIEW" ? status === "OPEN"
    : action === "CLOSE" ? status === "REVIEWED"
    : action === "REOPEN" ? status === "CLOSED"
    : action === "DUPLICATE" ? status !== "CLOSED"
    : ["NOTIFY", "ACKNOWLEDGE", "ANNOTATE"].includes(action);
  if (!allowed) throw Object.assign(new Error("Record changed or action is unavailable. Refresh before continuing."), { status: 409 });
  if (action === "REVIEW" && priority === "UNASSESSED") throw Object.assign(new Error("Record an assessed local priority before review"), { status: 422 });
}
// JSONB key ordering must not change the evidence digest.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function surveillanceHash(value: unknown) { return auditValueFingerprint(canonical(value)); }
export const surveillanceDescriptor = { scope: "LOCAL_SURVEILLANCE_REGISTER", nationalRules: "UNCONFIGURED", transport: "DISABLED", acknowledgementAssurance: "STAFF_RECORDED_ONLY" };
