import { z } from "zod";

export const visitStatuses = [
  "REGISTERED", "AWAITING_TRIAGE", "AWAITING_CLINICIAN", "UNDER_CONSULTATION",
  "ORDERS_PENDING", "AWAITING_RESULTS", "AWAITING_PHARMACY", "AWAITING_PAYMENT",
  "ADMITTED", "REFERRED", "DISCHARGED", "COMPLETED", "CANCELLED"
] as const;

export type VisitStatus = typeof visitStatuses[number];

export const allowedVisitTransitions: Record<VisitStatus, readonly VisitStatus[]> = {
  REGISTERED: ["AWAITING_TRIAGE", "CANCELLED"],
  AWAITING_TRIAGE: ["AWAITING_CLINICIAN", "CANCELLED"],
  AWAITING_CLINICIAN: ["UNDER_CONSULTATION", "CANCELLED"],
  UNDER_CONSULTATION: ["ORDERS_PENDING", "AWAITING_RESULTS", "AWAITING_PHARMACY", "AWAITING_PAYMENT", "ADMITTED", "REFERRED", "DISCHARGED"],
  ORDERS_PENDING: ["AWAITING_RESULTS", "AWAITING_PHARMACY", "AWAITING_PAYMENT"],
  AWAITING_RESULTS: ["UNDER_CONSULTATION", "AWAITING_PHARMACY", "AWAITING_PAYMENT"],
  AWAITING_PHARMACY: ["AWAITING_PAYMENT", "DISCHARGED"],
  AWAITING_PAYMENT: ["DISCHARGED", "COMPLETED"],
  ADMITTED: ["DISCHARGED", "REFERRED"],
  REFERRED: ["COMPLETED"],
  DISCHARGED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: []
};

export function assertVisitTransition(from: VisitStatus, to: VisitStatus) {
  if (!allowedVisitTransitions[from].includes(to)) throw new Error(`Visit cannot move from ${from} to ${to}`);
}

export const patientRegistrationSchema = z.object({
  givenName: z.string().trim().min(1).max(60).optional(),
  middleName: z.string().trim().max(60).optional(),
  familyName: z.string().trim().min(1).max(60).optional(),
  fullName: z.string().trim().min(3).max(160).optional(),
  dateOfBirth: z.iso.date().optional(),
  estimatedAgeYears: z.coerce.number().int().min(0).max(120).optional(),
  sexAtBirth: z.enum(["FEMALE", "MALE", "INTERSEX", "UNKNOWN"]),
  phone: z.string().trim().min(7).max(30),
  alternativePhone: z.string().trim().max(30).optional(),
  nationalId: z.string().trim().max(80).optional(),
  shaNumber: z.string().trim().max(80).optional(),
  county: z.string().trim().min(2).max(80),
  subcounty: z.string().trim().min(2).max(80),
  ward: z.string().trim().max(80).optional(),
  village: z.string().trim().max(120).optional(),
  preferredLanguage: z.enum(["English", "Kiswahili"]).default("English"),
  treatmentConsent: z.literal(true),
  electronicRecordConsent: z.literal(true),
  messagingConsent: z.boolean().default(false)
}).refine(value => value.fullName || (value.givenName && value.familyName), { message: "First name and surname are required", path: ["givenName"] }).refine(value => value.dateOfBirth || value.estimatedAgeYears !== undefined, { message: "Date of birth or estimated age is required", path: ["dateOfBirth"] });

export const triageSchema = z.object({
  temperatureC: z.coerce.number().min(25).max(45),
  pulseBpm: z.coerce.number().int().min(20).max(300),
  respiratoryRate: z.coerce.number().int().min(4).max(100),
  systolicBp: z.coerce.number().int().min(40).max(300),
  diastolicBp: z.coerce.number().int().min(20).max(200),
  oxygenSaturation: z.coerce.number().min(40).max(100),
  weightKg: z.coerce.number().positive().max(500),
  heightCm: z.coerce.number().positive().max(260).optional(),
  painScore: z.coerce.number().int().min(0).max(10),
  consciousness: z.enum(["ALERT", "VOICE", "PAIN", "UNRESPONSIVE"]),
  triageCategory: z.enum(["ROUTINE", "PRIORITY", "URGENT", "EMERGENCY"]),
  notes: z.string().trim().max(2000).optional(),
  pregnancyStatus: z.enum(["NOT_APPLICABLE", "NOT_PREGNANT", "PREGNANT", "POSSIBLY_PREGNANT", "UNKNOWN"]).optional(),
  lastMenstrualPeriod: z.iso.date().optional()
});

export type PatientDemographics = { sexAtBirth: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN"; dateOfBirth?: string | Date | null; estimatedAgeYears?: number | null };

export function patientAgeYears(patient: PatientDemographics, now = new Date()) {
  if (patient.dateOfBirth) {
    const birth = new Date(patient.dateOfBirth);
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age--;
    return Math.max(0, age);
  }
  return patient.estimatedAgeYears ?? null;
}

export function patientClinicalGroup(patient: PatientDemographics, now = new Date()) {
  const age = patientAgeYears(patient, now);
  const ageGroup = age !== null && age < 18 ? "CHILD" : "ADULT";
  const label = ageGroup === "CHILD" ? `Child · ${age ?? "age unknown"} years` : `${patient.sexAtBirth.charAt(0)}${patient.sexAtBirth.slice(1).toLowerCase()} · ${age ?? "age unknown"} years`;
  const pregnancyQuestionsApply = ageGroup === "ADULT" && patient.sexAtBirth === "FEMALE" && age !== null && age >= 12 && age <= 55;
  return { age, ageGroup, label, pregnancyQuestionsApply };
}

export type TriageVitals = Pick<z.infer<typeof triageSchema>, "temperatureC" | "pulseBpm" | "respiratoryRate" | "systolicBp" | "diastolicBp" | "oxygenSaturation" | "painScore" | "consciousness">;

export function assessTriageVitals(vitals: TriageVitals) {
  const alerts: { severity: "CRITICAL" | "WARNING"; message: string }[] = [];
  if (vitals.oxygenSaturation < 90) alerts.push({ severity: "CRITICAL", message: "Oxygen saturation below 90%" });
  if (vitals.systolicBp < 90) alerts.push({ severity: "CRITICAL", message: "Systolic blood pressure below 90 mmHg" });
  if (vitals.systolicBp >= 180 || vitals.diastolicBp >= 120) alerts.push({ severity: "CRITICAL", message: "Severely elevated blood pressure" });
  if (vitals.temperatureC < 35 || vitals.temperatureC >= 39) alerts.push({ severity: "WARNING", message: "Temperature outside the expected range" });
  if (vitals.respiratoryRate < 10 || vitals.respiratoryRate > 30) alerts.push({ severity: "WARNING", message: "Respiratory rate outside the expected range" });
  if (vitals.pulseBpm < 50 || vitals.pulseBpm > 130) alerts.push({ severity: "WARNING", message: "Pulse outside the expected range" });
  if (vitals.painScore >= 7) alerts.push({ severity: "WARNING", message: "Severe pain score reported" });
  if (vitals.consciousness !== "ALERT") alerts.push({ severity: "CRITICAL", message: `Reduced consciousness: ${vitals.consciousness.toLowerCase()}` });
  return alerts;
}

export function patientNumber(code: string, year: number, sequence: bigint) {
  if (!/^[A-Z]{2,8}$/.test(code)) throw new Error("Invalid facility code");
  if (sequence < 1n) throw new Error("Sequence must be positive");
  return `${code}-${year}-${sequence.toString().padStart(6, "0")}`;
}

export function operationalReference(code: string, kind: "V" | "INV" | "RCT" | "CLM", year: number, sequence: bigint) {
  if (!/^[A-Z]{2,8}$/.test(code) || sequence < 1n) throw new Error("Invalid reference input");
  return `${code}-${kind}-${year}-${sequence.toString().padStart(6, "0")}`;
}

export function invoiceLineTotal(quantity: string, unitPrice: string) {
  const q = BigInt(quantity.replace(".", ""));
  const qScale = 10n ** BigInt((quantity.split(".")[1] || "").length);
  const [whole, fraction = ""] = unitPrice.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return (q * cents) / qScale;
}
