import { z } from "zod";
import { auditValueFingerprint } from "./audit";

export const localReportMonth = z.string().regex(/^(20\d{2})-(0[1-9]|1[0-2])$/, "Choose a reporting month between 2000 and 2099");
export const localReportPayload = z.object({
  sourceReference: z.string().trim().min(3).max(300),
  zeroConfirmed: z.boolean(),
  rows: z.array(z.object({
    indicator: z.string().trim().min(2).max(100),
    count: z.number().int().min(0).max(100000000).nullable(),
  }).strict()).min(1).max(40),
}).strict().superRefine((data, ctx) => {
  const keys = data.rows.map(row => row.indicator.toLowerCase());
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Indicator names must be unique", path: ["rows"] });
  if (data.zeroConfirmed && data.rows.some(row => row.count !== 0)) ctx.addIssue({ code: "custom", message: "Zero confirmation requires every indicator to be explicitly zero", path: ["zeroConfirmed"] });
});
export type LocalReportPayload = z.infer<typeof localReportPayload>;
export const localReportContract = "LOCAL_MANUAL_AGGREGATE_V1";
export function localReportHash(month: string, payload: LocalReportPayload) {
  return auditValueFingerprint({ contract: localReportContract, month, payload: localReportPayload.parse(payload) });
}
export function requireCompleteLocalReport(payload: LocalReportPayload) {
  if (payload.rows.some(row => row.count === null)) throw Object.assign(new Error("Missing counts must be resolved before review"), { status: 422 });
  if (payload.rows.every(row => row.count === 0) && !payload.zeroConfirmed) throw Object.assign(new Error("Confirm zero activity explicitly before review"), { status: 422 });
}
export function assertLocalReportTransition(status: string, action: string, contributors: string[], actorId: string) {
  const expected = { SAVE: "DRAFT", REQUEST_REVIEW: "DRAFT", RETURN: "IN_REVIEW", APPROVE: "IN_REVIEW", CORRECT: "APPROVED" }[action];
  if (!expected || status !== expected) throw Object.assign(new Error("Report changed or action is unavailable. Refresh before continuing."), { status: 409 });
  if (action === "APPROVE" && contributors.includes(actorId)) throw Object.assign(new Error("Approval requires a reviewer who did not prepare this revision"), { status: 403 });
}
