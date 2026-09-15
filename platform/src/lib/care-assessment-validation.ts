import type { CareField, CareServiceProfile } from "./care-service-points";

export type CareAssessmentIssue = {
  field?: string;
  message: string;
};

export type CareAssessmentValidation = {
  errors: CareAssessmentIssue[];
  warnings: CareAssessmentIssue[];
};

function hasValue(value: string | boolean | undefined) {
  return typeof value === "boolean" || Boolean(value?.trim());
}

function numberFrom(data: Record<string, string | boolean>, field: CareField) {
  const raw = data[field.key];
  if (!hasValue(raw) || typeof raw === "boolean") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function addIssue(list: CareAssessmentIssue[], field: CareField | undefined, message: string) {
  list.push({ field: field?.key, message });
}

/**
 * Shared browser/API validation for structured clinical numeric fields.
 * Hard bounds reject impossible or unsupported capture values. Normal-range
 * bounds are alerts only because an abnormal result can still be genuine.
 */
export function validateCareAssessment(
  profile: CareServiceProfile,
  data: Record<string, string | boolean>,
): CareAssessmentValidation {
  const errors: CareAssessmentIssue[] = [];
  const warnings: CareAssessmentIssue[] = [];
  const fields = profile.sections.flatMap((section) => section.fields);
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));

  for (const field of fields.filter((item) => item.type === "number")) {
    const raw = data[field.key];
    if (!hasValue(raw)) continue;
    if (typeof raw === "boolean" || !Number.isFinite(Number(raw))) {
      addIssue(errors, field, `${field.label} must be a valid number.`);
      continue;
    }

    const value = Number(raw);
    if (field.integer && !Number.isInteger(value)) {
      addIssue(errors, field, `${field.label} must be a whole number.`);
      continue;
    }
    if (field.min !== undefined && value < field.min) {
      addIssue(errors, field, `${field.label} cannot be below ${field.min}${field.unit ? ` ${field.unit}` : ""}.`);
      continue;
    }
    if (field.max !== undefined && value > field.max) {
      addIssue(errors, field, `${field.label} cannot exceed ${field.max}${field.unit ? ` ${field.unit}` : ""}. Verify the entry before continuing.`);
      continue;
    }
    const outsideNormal =
      (field.normalMin !== undefined && value < field.normalMin) ||
      (field.normalMax !== undefined && value > field.normalMax);
    if (outsideNormal) {
      addIssue(
        warnings,
        field,
        field.rangeWarning || `${field.label} is outside the configured clinical review range. Verify and assess the patient.`,
      );
    }
  }

  if (profile.code === "ANC") {
    const gravidaField = fieldsByKey.get("gravida");
    const paraField = fieldsByKey.get("para");
    const abortionsField = fieldsByKey.get("abortions");
    const gravida = gravidaField ? numberFrom(data, gravidaField) : null;
    const para = paraField ? numberFrom(data, paraField) : null;
    const abortions = abortionsField ? numberFrom(data, abortionsField) : null;

    if (
      gravida !== null && para !== null && abortions !== null &&
      Number.isInteger(gravida) && Number.isInteger(para) && Number.isInteger(abortions) &&
      gravida >= 1 && para >= 0 && abortions >= 0
    ) {
      const completedPreviousPregnancies = gravida - 1;
      const recordedOutcomes = para + abortions;
      if (recordedOutcomes > completedPreviousPregnancies) {
        addIssue(
          errors,
          gravidaField,
          `Parity (${para}) plus miscarriages / abortions (${abortions}) cannot exceed the ${completedPreviousPregnancies} previous ${completedPreviousPregnancies === 1 ? "pregnancy" : "pregnancies"} implied by gravida ${gravida}.`,
        );
      } else if (recordedOutcomes < completedPreviousPregnancies) {
        const explanation = data.previousPregnancies;
        const message = `Gravida ${gravida} implies ${completedPreviousPregnancies} previous ${completedPreviousPregnancies === 1 ? "pregnancy" : "pregnancies"}, but parity plus miscarriages / abortions accounts for ${recordedOutcomes}.`;
        if (typeof explanation === "string" && explanation.trim()) {
          addIssue(warnings, gravidaField, `${message} Verify the documented outcome explanation.`);
        } else {
          addIssue(errors, gravidaField, `${message} Correct the figures or explain the other outcome under Previous pregnancy outcomes and complications.`);
        }
      }
    }
  }

  return { errors, warnings };
}
