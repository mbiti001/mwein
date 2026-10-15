import { z } from "zod";

export const deliveryMethods = ["IN_PERSON", "SECURE_PORTAL", "ENCRYPTED_TRANSFER", "OTHER_APPROVED_CHANNEL"] as const;
export const confirmDeliverySchema = z.object({
  action: z.literal("CONFIRM_DELIVERY"),
  requestId: z.uuid(),
  responseEvidenceReference: z.string().regex(/^audit:[0-9a-f-]{36}$/i),
  recipientKind: z.enum(["PATIENT", "AUTHORIZED_REPRESENTATIVE"]),
  recipientReference: z.string().trim().min(3).max(300),
  identityEvidenceReference: z.string().trim().min(3).max(500),
  authorityEvidenceReference: z.string().trim().min(3).max(500).optional(),
  method: z.enum(deliveryMethods),
  deliveryEvidenceReference: z.string().trim().min(3).max(500),
  deliveredAt: z.iso.datetime({ offset: true }).optional(),
  resolution: z.string().trim().min(10).max(2000),
  attested: z.literal(true),
}).strict().superRefine((value, context) => {
  if (value.recipientKind === "AUTHORIZED_REPRESENTATIVE" && !value.authorityEvidenceReference)
    context.addIssue({ code: "custom", path: ["authorityEvidenceReference"], message: "A representative requires retained authority evidence" });
  if (value.deliveredAt && new Date(value.deliveredAt) > new Date())
    context.addIssue({ code: "custom", path: ["deliveredAt"], message: "Delivery time cannot be in the future" });
});

export type DeliveryEvidence = Omit<z.infer<typeof confirmDeliverySchema>, "action" | "requestId"> & {
  deliveredAt: string;
  recordedAt: string;
  recordedById: string;
};
