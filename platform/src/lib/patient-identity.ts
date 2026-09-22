import { z } from "zod";
export const identityInput = z.object({
  givenName: z.string().trim().min(1).max(80), middleName: z.string().trim().max(80).optional(), familyName: z.string().trim().min(1).max(80),
  dateOfBirth: z.iso.date().refine(value => value <= new Date().toISOString().slice(0, 10), "Date of birth cannot be in the future").optional(),
  estimatedAgeYears: z.number().int().min(0).max(130).optional(), sexAtBirth: z.enum(["FEMALE", "MALE", "INTERSEX", "UNKNOWN"]),
  identifierType: z.enum(["NATIONAL_ID", "SHA", "BIRTH_CERTIFICATE", "PASSPORT", "OTHER"]), identifierValue: z.string().trim().min(3).max(120), issuer: z.string().trim().max(160).optional(),
  evidenceType: z.enum(["PATIENT_DOCUMENT", "REPRESENTATIVE_DOCUMENT", "NATIONAL_REGISTRY", "CLINICAL_CONFIRMATION"]), evidenceReference: z.string().trim().min(5).max(800), reason: z.string().trim().min(10).max(1000),
}).refine(value => Boolean(value.dateOfBirth) !== (value.estimatedAgeYears !== undefined), { message: "Provide either date of birth or estimated age, not both", path: ["dateOfBirth"] });
export type IdentityDemographics = { givenName: string | null; middleName: string | null; familyName: string | null; fullName: string; normalizedName: string; dateOfBirth: Date | string | null; estimatedAgeYears: number | null; sexAtBirth: string; identityStatus: string };
export function identitySnapshot(patient: IdentityDemographics) {
  return { givenName: patient.givenName, middleName: patient.middleName, familyName: patient.familyName, fullName: patient.fullName, normalizedName: patient.normalizedName,
    dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString() : null, estimatedAgeYears: patient.estimatedAgeYears, sexAtBirth: patient.sexAtBirth, identityStatus: patient.identityStatus };
}
export function canReverseIdentity(current: IdentityDemographics, resulting: unknown) {
  if (!resulting || typeof resulting !== "object") return false;
  const snapshot = identitySnapshot(current);
  return Object.entries(snapshot).every(([key, value]) => (resulting as Record<string, unknown>)[key] === value);
}
