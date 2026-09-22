import { z } from "zod";
// Measurement ranges match the existing triage input limits; this is not clinical prioritisation.
export const measuredVitalFields = [
  { key: "temperatureC", label: "Temperature °C", min: 25, max: 45, step: 0.1 },
  { key: "pulseBpm", label: "Pulse /min", min: 20, max: 300, step: 1 },
  { key: "respiratoryRate", label: "Respirations /min", min: 4, max: 100, step: 1 },
  { key: "systolicBp", label: "BP systolic", min: 40, max: 300, step: 1 },
  { key: "diastolicBp", label: "BP diastolic", min: 20, max: 200, step: 1 },
  { key: "oxygenSaturation", label: "SpO₂ %", min: 40, max: 100, step: 0.1 },
  { key: "weightKg", label: "Weight kg", min: 0.1, max: 500, step: 0.1 },
  { key: "heightCm", label: "Height cm", min: 0.1, max: 260, step: 0.1 },
] as const;
export const measuredValuesSchema = z.object({
  temperatureC: z.number().min(25).max(45).optional(), pulseBpm: z.number().int().min(20).max(300).optional(),
  respiratoryRate: z.number().int().min(4).max(100).optional(), systolicBp: z.number().int().min(40).max(300).optional(),
  diastolicBp: z.number().int().min(20).max(200).optional(), oxygenSaturation: z.number().min(40).max(100).optional(),
  weightKg: z.number().positive().max(500).optional(), heightCm: z.number().positive().max(260).optional(),
}).strict().superRefine((value, ctx) => {
  if (!Object.values(value).some(item => item !== undefined)) ctx.addIssue({ code: "custom", message: "Enter at least one measured value" });
  if ((value.systolicBp === undefined) !== (value.diastolicBp === undefined)) ctx.addIssue({ code: "custom", message: "Record both blood pressure values, or leave both blank" });
});
export const measuredVitalsSchema = z.object({
  measuredAt: z.iso.datetime().refine(value => new Date(value).getTime() <= Date.now(), "Measurement time cannot be in the future"),
  values: measuredValuesSchema,
  note: z.string().trim().max(500).optional(),
}).strict();
export type MeasuredValues = z.infer<typeof measuredValuesSchema>;
