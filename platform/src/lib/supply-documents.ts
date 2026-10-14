import { z } from "zod";

const amount = z.string().regex(/^\d+(\.\d+)?$/);
export const supplyDocumentSchema = z.object({
  version: z.literal(1),
  kind: z.enum(["PURCHASE_ORDER", "GOODS_RECEIPT"]),
  reference: z.string(),
  facilityName: z.string(),
  facilityCode: z.string(),
  status: z.string(),
  date: z.string(),
  supplier: z.object({ name: z.string(), code: z.string(), phone: z.string().nullable(), email: z.string().nullable() }),
  orderNumber: z.string(),
  expectedAt: z.string().nullable(),
  notes: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  actors: z.array(z.object({ label: z.string(), name: z.string(), at: z.string() })),
  lines: z.array(z.object({
    code: z.string(), name: z.string(), quantity: amount, unitCost: amount.nullable(), total: amount.nullable(),
    receivedQuantity: amount.optional(), batchNumber: z.string().optional(), expiryDate: z.string().optional(), storeName: z.string().optional(),
  })).min(1),
  total: amount.nullable(),
});

export type SupplyDocument = z.infer<typeof supplyDocumentSchema>;
export type SupplyDocumentKind = SupplyDocument["kind"];
export type SupplyDocumentIndex = {
  id: string; kind: SupplyDocumentKind; reference: string; date: string; status: string; supplierName: string;
};

export function supplyDocumentStatus(document: Pick<SupplyDocument, "kind" | "status">) {
  if (document.kind === "GOODS_RECEIPT") return "POSTED RECEIPT";
  if (document.status === "CANCELLED") return "CANCELLED — DO NOT SUPPLY";
  if (["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(document.status)) return document.status.replaceAll("_", " ");
  return `${document.status.replaceAll("_", " ")} — NOT AUTHORISED`;
}
