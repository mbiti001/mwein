import { patientAgeYears, type PatientDemographics } from "./domain";

export const ANC_CLINICAL_REFERENCE =
  "WHO recommendations on antenatal care for a positive pregnancy experience (2016); WHO Global standards for quality health care services for adolescents (2025)";

export type AncAdmissionInput = {
  result: "POSITIVE" | "NEGATIVE" | "PENDING" | "NOT_TESTED";
  method: "FACILITY_LAB" | "EXTERNAL_LAB";
  testedAt: string;
  evidenceReference: string;
  consentConfirmed: boolean;
};

export type AncAdmissionDecision =
  | { admitted: true; safeguardingReviewRequired: boolean; age: number | null }
  | { admitted: false; safeguardingReviewRequired: false; age: number | null; reason: string };

export function assessAncAdmission(
  patient: PatientDemographics,
  evidence: AncAdmissionInput | undefined,
  now = new Date(),
): AncAdmissionDecision {
  const age = patientAgeYears(patient, now);
  if (!evidence)
    return {
      admitted: false,
      safeguardingReviewRequired: false,
      age,
      reason:
        "ANC check-in requires a consented, documented positive pregnancy test. Route the patient to pregnancy confirmation or general clinical assessment first.",
    };
  if (!evidence.consentConfirmed)
    return {
      admitted: false,
      safeguardingReviewRequired: false,
      age,
      reason: "Confirm informed consent before recording pregnancy-test evidence.",
    };
  if (evidence.result !== "POSITIVE")
    return {
      admitted: false,
      safeguardingReviewRequired: false,
      age,
      reason:
        "Only a confirmed positive result can open a routine ANC visit. Route negative, pending or untested patients to pregnancy confirmation or general clinical assessment.",
    };
  const testedAt = new Date(`${evidence.testedAt}T00:00:00.000Z`);
  if (!Number.isFinite(testedAt.getTime()) || testedAt.getTime() > now.getTime())
    return {
      admitted: false,
      safeguardingReviewRequired: false,
      age,
      reason: "Pregnancy-test date must be a valid date that is not in the future.",
    };
  return { admitted: true, safeguardingReviewRequired: age === null || age < 15, age };
}
