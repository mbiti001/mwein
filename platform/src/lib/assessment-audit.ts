import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

type AssessmentSnapshot = {
  id: string;
  encounterId: string;
  servicePoint: string;
  templateVersion: string;
  data: Prisma.JsonValue;
  riskLevel: string | null;
  followUpAt: Date | string | null;
  updatedById: string;
  updatedAt: Date | string;
};

// JSON object order is not meaningful (including after a PostgreSQL JSONB read).
// Preserve array order, scalar types, missing keys, empty values and Unicode.
function canonicalJson(value: Prisma.JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Versioned evidence of persisted state, not an encryption or history store. */
export function assessmentAuditFingerprint(facilityId: string, visitId: string, record: AssessmentSnapshot | null) {
  const snapshot: Prisma.JsonValue = [
    "assessment-v1", facilityId, visitId,
    record ? [record.id, record.encounterId, record.servicePoint, record.templateVersion,
      record.data, record.riskLevel, record.followUpAt ? new Date(record.followUpAt).toISOString() : null,
      record.updatedById, new Date(record.updatedAt).toISOString()] : null,
  ];
  return `assessment-v1:${createHash("sha256").update(canonicalJson(snapshot)).digest("hex")}`;
}
