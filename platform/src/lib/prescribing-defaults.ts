import { z } from "zod";

// Configuration belongs to one facility catalogue item. No clinical regimen is inferred.
export const prescribingDefaultsSchema = z.object({
  route: z.string().trim().min(1).max(50),
  frequencyPerDay: z.number().int().min(1).max(24),
  durationDays: z.number().int().min(1).max(3650),
  doseUnit: z.string().trim().min(1).max(40),
  doseUnitsPerIssueUnit: z.number().positive().max(1000000),
  wholeIssueUnits: z.boolean(),
}).strict();
export type PrescribingDefaults = z.infer<typeof prescribingDefaultsSchema>;
export function readPrescribingDefaults(value: unknown): PrescribingDefaults | null {
  const parsed = prescribingDefaultsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function frequencyLabel(count: number) {
  return ["", "Once daily", "Twice daily", "Three times daily", "Four times daily"][count] || `${count} times daily`;
}
export function prescriptionCalculation(dose: string, frequency: string, days: string, config: PrescribingDefaults | null) {
  if (!config) return null;
  const match = dose.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return null;
  const unit = config.doseUnit.toLowerCase();
  const acceptedUnits = [unit, ...(["tablet", "capsule"].includes(unit) ? [unit + "s"] : [])];
  if (match[2] && !acceptedUnits.includes(match[2].toLowerCase())) return null;
  const amount = Number(match[1]);
  const count = Number(frequency);
  const duration = Number(days);
  if (!(amount > 0) || !Number.isInteger(count) || count < 1 || count > 24 || !Number.isInteger(duration) || duration < 1 || duration > 3650) return null;
  const doseQuantity = amount / config.doseUnitsPerIssueUnit;
  // Persisted doseQuantity has three decimal places; reject lossy conversions.
  if (Math.abs(doseQuantity * 1000 - Math.round(doseQuantity * 1000)) > 1e-8 || doseQuantity > 1000) return null;
  const total = Number((doseQuantity * count * duration).toFixed(3));
  const quantity = config.wholeIssueUnits ? Math.ceil(total) : total;
  if (!(quantity > 0) || quantity > 10000) return null;
  return { dose: match[2] ? dose.trim() : `${amount} ${config.doseUnit}`, doseQuantity: Number(doseQuantity.toFixed(3)), quantity };
}
