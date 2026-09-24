import { createHash } from "node:crypto";
// Canonical object ordering makes the fingerprint stable after a JSONB round trip.
export function canonicalDocument(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDocument).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalDocument(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function clinicDocumentHash(record: { id: string; facilityId: string; visitId: string | null; kind: string; reference: string; revision: number; previousId: string | null; correctionReason: string | null; payload: unknown; context: unknown; signedById: string | null; signedAt: Date | null; signerName: string | null; signerRoles: string[]; signerRegistration: string | null; signerSessionId: string | null }) {
  const { id, facilityId, visitId, kind, reference, revision, previousId, correctionReason, payload, context, signedById, signedAt, signerName, signerRoles, signerRegistration, signerSessionId } = record;
  return createHash("sha256").update(canonicalDocument({ id, facilityId, visitId, kind, reference, revision, previousId, correctionReason, payload, context, signedById, signedAt: signedAt?.toISOString() || null, signerName, signerRoles, signerRegistration, signerSessionId })).digest("hex");
}
