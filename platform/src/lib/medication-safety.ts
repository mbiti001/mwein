import { createHash } from "node:crypto";
import { z } from "zod";

export const medicationSafetyRuleContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ALLERGY"), message: z.string().trim().min(10).max(500) }),
  z.object({ kind: z.literal("INTERACTION"), message: z.string().trim().min(10).max(500) }),
  z.object({ kind: z.literal("DOSE_LIMIT"), message: z.string().trim().min(10).max(500), maxDailyQuantity: z.number().positive().max(100000) }),
]);

export type MedicationSafetyRuleInput = {
  id: string;
  code: string;
  kind: string;
  severity: string;
  status: string;
  primaryConceptId: string | null;
  interactingConceptId: string | null;
  version: string;
  rule: unknown;
};

export type MedicationSafetyContext = {
  medicationConceptId: string;
  patientAllergyConcepts: string[];
  activeMedicationConcepts: string[];
  dailyDoseQuantity?: number;
};

export type MedicationSafetyResult = {
  ruleId: string;
  warningCode: string;
  severity: "WARNING" | "HARD_STOP";
  outcome: "PASS" | "WARN" | "BLOCK" | "UNAVAILABLE";
  message: string;
  ruleVersion: string;
};

const concept = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function evaluateMedicationSafety(rules: MedicationSafetyRuleInput[], context: MedicationSafetyContext) {
  const primary = concept(context.medicationConceptId);
  const allergies = new Set(context.patientAllergyConcepts.map(concept));
  const active = new Set(context.activeMedicationConcepts.map(concept));
  const results: MedicationSafetyResult[] = [];
  for (const stored of rules) {
    if (stored.status !== "APPROVED" || !stored.primaryConceptId || concept(stored.primaryConceptId) !== primary) continue;
    const parsed = medicationSafetyRuleContentSchema.safeParse(stored.rule);
    if (!parsed.success || parsed.data.kind !== stored.kind) continue;
    const severity = stored.severity === "HARD_STOP" ? "HARD_STOP" : "WARNING";
    let matched = false;
    let unavailable = false;
    if (parsed.data.kind === "ALLERGY") matched = allergies.has(primary);
    if (parsed.data.kind === "INTERACTION") {
      matched = Boolean(stored.interactingConceptId && active.has(concept(stored.interactingConceptId)));
    }
    if (parsed.data.kind === "DOSE_LIMIT") {
      unavailable = context.dailyDoseQuantity === undefined;
      matched = !unavailable && context.dailyDoseQuantity! > parsed.data.maxDailyQuantity;
    }
    const outcome: MedicationSafetyResult["outcome"] = unavailable ? "UNAVAILABLE" : matched ? severity === "HARD_STOP" ? "BLOCK" : "WARN" : "PASS";
    results.push({ ruleId: stored.id, warningCode: stored.code, severity, outcome, message: parsed.data.message, ruleVersion: stored.version });
  }
  return results;
}

export function medicationSafetyContextHash(context: MedicationSafetyContext) {
  return createHash("sha256").update(JSON.stringify({
    medicationConceptId: concept(context.medicationConceptId),
    patientAllergyConcepts: context.patientAllergyConcepts.map(concept).sort(),
    activeMedicationConcepts: context.activeMedicationConcepts.map(concept).sort(),
    dailyDoseQuantity: context.dailyDoseQuantity ?? null,
  })).digest("hex");
}
