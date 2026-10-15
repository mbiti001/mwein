import type { Prisma } from "@prisma/client";
import type { DocumentKind } from "./clinic-documents";
type NumberedDocumentKind = DocumentKind | "PO" | "GRN";

export function documentYear(timezone: string, now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric" }).format(now));
}

export function documentReference(code: string, kind: NumberedDocumentKind, year: number, sequence: bigint): string {
  if (!code.trim() || !Number.isInteger(year) || sequence < 1n) throw new Error("Invalid document numbering configuration");
  return `${code}-${kind}-${year}-${String(sequence).padStart(6, "0")}`;
}

export async function allocateDocumentReference(tx: Prisma.TransactionClient, facility: { id: string; code: string; timezone: string }, kind: NumberedDocumentKind, now = new Date()) {
  const year = documentYear(facility.timezone, now);
  const counterKind = kind === "PO" ? "PURCHASE_ORDER" : kind === "GRN" ? "GOODS_RECEIPT" : `CLINIC_DOCUMENT_${kind}`;
  const counter = await tx.referenceSequence.upsert({
    where: { facilityId_kind_year: { facilityId: facility.id, kind: counterKind, year } },
    create: { facilityId: facility.id, kind: counterKind, year, nextValue: 2n },
    update: { nextValue: { increment: 1 } },
  });
  return documentReference(facility.code, kind, year, counter.nextValue - 1n);
}

// Retry the entire transaction; never retry only the counter or audit write.
export async function retryDocumentTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= 3 || !["P2034", "P2002"].includes(code || "")) throw error;
    }
  }
}
