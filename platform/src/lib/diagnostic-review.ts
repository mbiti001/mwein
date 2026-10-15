import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { verifiedResultWhere } from "./verified-results";

export const diagnosticReviewInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CLAIM"), expectedEventId: z.uuid().nullable(), requestKey: z.uuid(), note: z.string().trim().min(3).max(2000) }).strict(),
  z.object({ action: z.literal("ACKNOWLEDGE"), expectedEventId: z.uuid(), requestKey: z.uuid(), note: z.string().trim().min(3).max(2000), resultId: z.uuid(), verifiedAt: z.iso.datetime(), attested: z.literal(true) }).strict(),
]);

export const diagnosticEventSelect = {
  id: true, sequence: true, action: true, note: true, resultId: true, verifiedAt: true, recordedAt: true,
  actor: { select: { id: true, displayName: true } },
} satisfies Prisma.DiagnosticReviewSelect;

export const diagnosticOrderSelect = {
  id: true, displayName: true, type: true, status: true, priority: true, requestedAt: true,
  orderedBy: { select: { displayName: true } },
  visit: { select: { id: true, visitNumber: true, status: true, clinicallyClosedAt: true, patient: { select: { fullName: true, patientNumber: true } } } },
  laboratory: { select: { specimenStatus: true, result: { where: verifiedResultWhere, select: { id: true, verifiedAt: true } } } },
  imaging: { select: { result: { where: verifiedResultWhere, select: { id: true, verifiedAt: true } } } },
  diagnosticReviews: { orderBy: { sequence: "desc" }, take: 1, select: diagnosticEventSelect },
} satisfies Prisma.ClinicalOrderSelect;
