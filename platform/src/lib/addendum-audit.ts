import { createHash } from "node:crypto";

/** Persisted narrative evidence, separate from structured assessment revisions. */
export function addendumAuditFingerprint(facilityId: string, visitId: string, record: {
  id: string; encounterId: string; authorId: string; reason: string; text: string; createdAt: Date | string;
}) {
  const snapshot = ["addendum-v1", facilityId, visitId, record.id, record.encounterId,
    record.authorId, record.reason, record.text, new Date(record.createdAt).toISOString()];
  return `addendum-v1:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}
