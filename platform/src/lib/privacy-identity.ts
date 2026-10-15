import { z } from "zod";

export const identityFields = z.object({
  requestKey: z.uuid(),
  requesterKind: z.enum(["PATIENT", "AUTHORIZED_REPRESENTATIVE"]),
  requesterReference: z.string().trim().min(3).max(300),
  identityEvidenceReference: z.string().trim().min(3).max(500),
  relationship: z.string().trim().min(3).max(120).optional(),
  authorityEvidenceReference: z.string().trim().min(3).max(500).optional(),
  authorizationScope: z.enum(["REQUEST_REVIEW_ONLY", "PATIENT_RECORD_EXPORT"]),
  scopeSummary: z.string().trim().min(10).max(1000),
  attested: z.literal(true),
});
function representativeCheck(value: z.infer<typeof identityFields>, context: z.RefinementCtx) {
  if (value.requesterKind === "AUTHORIZED_REPRESENTATIVE" && (!value.relationship || !value.authorityEvidenceReference))
    context.addIssue({ code: "custom", path: ["authorityEvidenceReference"], message: "A representative requires relationship and retained authority evidence" });
  if (value.requesterKind === "PATIENT" && (value.relationship || value.authorityEvidenceReference))
    context.addIssue({ code: "custom", path: ["requesterKind"], message: "Patient verification must not contain representative authority" });
}
export const verifyIdentitySchema = identityFields.extend({ action: z.literal("VERIFY_IDENTITY"), requestId: z.uuid() }).strict().superRefine(representativeCheck);
export const identityEvidenceSchema = identityFields.extend({
  version: z.literal(1), requestId: z.string().min(1), patientId: z.string().min(1), facilityId: z.string().min(1), requestType: z.string().min(1),
  verifiedAt: z.iso.datetime(), verifiedById: z.string().min(1), verifiedByName: z.string().min(1),
}).superRefine(representativeCheck);
export type IdentityEvidence = z.infer<typeof identityEvidenceSchema>;
export function requireRightsIdentity(record: { id: string; patientId: string; facilityId: string; type: string; identityVerification?: unknown }, fullExport = false): IdentityEvidence {
  const parsed = identityEvidenceSchema.safeParse(record.identityVerification);
  if (!parsed.success || parsed.data.requestId !== record.id || parsed.data.patientId !== record.patientId || parsed.data.facilityId !== record.facilityId || parsed.data.requestType !== record.type)
    throw Object.assign(new Error("Record identity and representative-authority evidence for this request before continuing"), { status: 409 });
  if (fullExport && parsed.data.authorizationScope !== "PATIENT_RECORD_EXPORT")
    throw Object.assign(new Error("The verified authority covers request review only. A full patient-record export is not authorized"), { status: 409 });
  return parsed.data;
}
