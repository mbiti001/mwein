import { z } from "zod";

export const REFERRAL_ATTACHMENT_METADATA_VERSION = 1;

export const referralAttachmentInput = z.discriminatedUnion("sourceType", [
  z.object({
    sourceType: z.literal("LABORATORY_RESULT"),
    resultId: z.uuid(),
  }),
  z.object({
    sourceType: z.literal("IMAGING_RESULT"),
    resultId: z.uuid(),
  }),
]);

export const referralInput = z.object({
  visitId: z.uuid(),
  idempotencyKey: z.uuid(),
  type: z.enum(["INTERNAL", "EXTERNAL"]),
  referringDepartment: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(3).max(2000),
  clinicalSummary: z.string().trim().min(10).max(5000),
  diagnosisSummary: z.string().trim().min(2).max(1200),
  urgency: z.enum(["ROUTINE", "PRIORITY", "URGENT", "EMERGENCY"]),
  attachments: z.array(referralAttachmentInput).max(30).default([]),
  receivingFacility: z.string().trim().min(2).max(240),
  receivingDepartment: z.string().trim().max(160).optional(),
  appointmentAt: z.iso.datetime().optional(),
}).strict();

export const receivingAcknowledgementStatuses = [
  "ACCEPTED",
  "ATTENDED",
  "RETURNED",
] as const;

const acknowledgementInput = z.object({
  providerName: z.string().trim().min(2).max(160),
  providerRole: z.string().trim().max(120).optional(),
  registrationNumber: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  acknowledgedAt: z.iso.datetime().optional(),
});

export const referralStatusInput = z
  .object({
    status: z.enum(["SENT", "ACCEPTED", "ATTENDED", "RETURNED", "CLOSED"]),
    feedback: z.string().trim().max(3000).optional(),
    acknowledgement: acknowledgementInput.optional(),
  })
  .superRefine((input, context) => {
    if (
      receivingAcknowledgementStatuses.includes(
        input.status as (typeof receivingAcknowledgementStatuses)[number],
      ) &&
      !input.acknowledgement
    ) {
      context.addIssue({
        code: "custom",
        path: ["acknowledgement"],
        message: `Receiving-provider acknowledgement is required for ${input.status.toLowerCase()}`,
      });
    }
  });

export function referralAttachmentHref(sourceType: string, resultId: string) {
  const kind = sourceType === "LABORATORY_RESULT" ? "laboratory" : "imaging";
  return `/api/clinical-results/${kind}/${resultId}`;
}

export function serializeReferral<T extends {
  legacyAttachedResults?: unknown;
  attachments: Array<{
    id: string;
    sourceType: string;
    laboratoryResultId: string | null;
    imagingResultId: string | null;
    metadataVersion: number;
    metadata: unknown;
    attachedAt: Date;
    attachedBy: { displayName: string };
  }>;
}>(referral: T) {
  const { legacyAttachedResults: _legacyAttachedResults, attachments, ...rest } = referral;
  return {
    ...rest,
    attachments: attachments.map((attachment) => {
      const resultId = attachment.laboratoryResultId || attachment.imagingResultId!;
      return {
        id: attachment.id,
        sourceType: attachment.sourceType,
        resultId,
        href: referralAttachmentHref(attachment.sourceType, resultId),
        metadataVersion: attachment.metadataVersion,
        metadata: attachment.metadata,
        attachedAt: attachment.attachedAt,
        attachedBy: attachment.attachedBy,
      };
    }),
  };
}
