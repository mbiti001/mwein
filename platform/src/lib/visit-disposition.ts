import { z } from "zod";

export const visitDispositionOptions = [
  { code: "RECOVERED", label: "Recovered" },
  { code: "OUTPATIENT", label: "Discharged for outpatient care (not necessarily recovered)" },
  { code: "DECEASED", label: "Deceased" },
  { code: "REFERRED", label: "Referred to another facility" },
  { code: "AGAINST_MEDICAL_ADVICE", label: "Discharged against medical advice" },
  { code: "OTHER", label: "Other documented outcome" },
] as const;

export const consultationDispositionCodes = ["RECOVERED", "ADMIT", "REFER", "DECEASED", "AGAINST_MEDICAL_ADVICE", "OTHER", "OUTPATIENT"] as const;

export const visitDispositionSchema = z.object({
  disposition: z.enum(consultationDispositionCodes),
  dispositionDetails: z.string().trim().max(1000).optional(),
  cancelPendingOrders: z.boolean().default(false),
}).superRefine((value, context) => {
  if (["DECEASED", "AGAINST_MEDICAL_ADVICE", "OTHER"].includes(value.disposition) && (!value.dispositionDetails || value.dispositionDetails.length < 10))
    context.addIssue({ code: "custom", path: ["dispositionDetails"], message: "Document the circumstances, counselling and next step" });
});

export function normalizedVisitOutcome(disposition: string) {
  if (disposition === "REFER") return "REFERRED";
  if (disposition === "ADMIT") return null;
  return visitDispositionOptions.some((option) => option.code === disposition) ? disposition : null;
}

export function dispositionVisitStatus(disposition: string, medicines: number) {
  if (disposition === "ADMIT") return "ADMITTED";
  if (["REFER", "DECEASED", "AGAINST_MEDICAL_ADVICE", "OTHER"].includes(disposition)) return "DISCHARGED";
  return medicines ? "AWAITING_PHARMACY" : "AWAITING_PAYMENT";
}

export const closeVisitSchema = z.object({
  outcome: z.enum(["RECOVERED", "OUTPATIENT", "DECEASED", "REFERRED", "AGAINST_MEDICAL_ADVICE", "OTHER"]),
  details: z.string().trim().min(10).max(2000),
  cancelPendingOrders: z.boolean().default(false),
});

export function clinicalClosureBlockers(visit: { status: string; encounters: { status: string }[]; orders: { status: string }[] }, cancelPendingOrders: boolean) {
  const blockers: string[] = [];
  if (["DISCHARGED", "COMPLETED", "CANCELLED"].includes(visit.status)) blockers.push("This visit is already closed");
  if (!visit.encounters.some(item => ["SIGNED", "CORRECTED"].includes(item.status))) blockers.push("Sign the clinical assessment before discharge");
  if (visit.orders.some(item => item.status === "IN_PROGRESS")) blockers.push("Resolve in-progress services before closure; do not discard work already underway");
  if (!cancelPendingOrders && visit.orders.some(item => ["DRAFT", "REQUESTED"].includes(item.status))) blockers.push("Complete pending orders or explicitly confirm their cancellation with a documented handover plan");
  return blockers;
}
