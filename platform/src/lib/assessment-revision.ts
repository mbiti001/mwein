import { createHash } from "node:crypto";

type RevisionEncounter = { id: string; status: string; updatedAt: Date | string };
type RevisionRecord = { id: string; updatedAt: Date | string; templateVersion: string };

/** An observed snapshot, never an authorization credential. Null means no encounter. */
export function assessmentRevision(visitId: string, encounter?: RevisionEncounter | null, record?: RevisionRecord | null): string | null {
  if (!encounter) return null;
  return createHash("sha256").update(JSON.stringify([
    "assessment-v1", visitId, encounter.id, encounter.status, new Date(encounter.updatedAt).toISOString(),
    record ? [record.id, new Date(record.updatedAt).toISOString(), record.templateVersion] : null,
  ])).digest("hex");
}

export function assessmentConflict() {
  return Object.assign(new Error("The saved assessment or consultation has changed. Your entries are still here. Review the latest saved assessment before continuing."), {
    status: 409, details: { code: "ASSESSMENT_REVISION_CONFLICT" },
  });
}
