import { Prisma } from "@prisma/client";
import { aiVisitSummaryInputSchema, type AiVisitSummaryInput } from "./visit-summary";

export const aiVisitSummaryInclude = {
  patient: {
    select: {
      dateOfBirth: true,
      estimatedAgeYears: true,
      sexAtBirth: true,
      allergies: { where: { active: true }, select: { substance: true, reaction: true, severity: true } },
    },
  },
  triage: { include: { observations: true } },
  encounters: {
    where: { status: "SIGNED" },
    include: { diagnoses: true },
    orderBy: { signedAt: "desc" },
  },
  orders: {
    where: { status: { not: "CANCELLED" } },
    include: {
      laboratory: { include: { result: { include: { items: true } } } },
      imaging: { include: { result: true } },
      prescription: true,
    },
    orderBy: { requestedAt: "asc" },
  },
  referrals: {
    orderBy: { createdAt: "asc" },
    select: {
      referralNumber: true,
      status: true,
      urgency: true,
      reason: true,
      receivingFacility: true,
      receivingDepartment: true,
      appointmentAt: true,
      feedback: true,
    },
  },
} satisfies Prisma.VisitInclude;

export type AiVisitSummaryVisit = Prisma.VisitGetPayload<{ include: typeof aiVisitSummaryInclude }>;

function record(value: string | null | undefined) {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function labelled(label: string, value: unknown) {
  const content = text(value);
  return content ? `${label}: ${content}` : null;
}

function ageAtVisit(dateOfBirth: Date | null, estimatedAgeYears: number | null, visitDate: Date) {
  if (!dateOfBirth) return estimatedAgeYears;
  let age = visitDate.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday = visitDate.getUTCMonth() < dateOfBirth.getUTCMonth()
    || (visitDate.getUTCMonth() === dateOfBirth.getUTCMonth() && visitDate.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

function complaintLines(subjective: Record<string, unknown>) {
  if (Array.isArray(subjective.complaints)) {
    const lines = subjective.complaints.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const complaint = value as Record<string, unknown>;
      const name = text(complaint.complaint);
      if (!name) return [];
      const durationValue = typeof complaint.durationValue === "number" ? complaint.durationValue : null;
      const durationUnit = text(complaint.durationUnit)?.toLowerCase();
      const legacyDuration = text(complaint.legacyDuration);
      const duration = durationValue != null && durationUnit ? `${durationValue} ${durationUnit}` : legacyDuration;
      return [duration ? `${name} · ${duration}` : name];
    });
    if (lines.length) return lines;
  }
  return [labelled("Chief complaint", subjective.chiefComplaint), labelled("Duration", subjective.symptomDuration)].filter((value): value is string => Boolean(value));
}

function observationLine(observation: AiVisitSummaryVisit["triage"] extends infer T
  ? T extends { observations: Array<infer O> } ? O : never
  : never) {
  const value = observation.valueText || (observation.valueDecimal == null ? null : String(observation.valueDecimal));
  const severity = observation.critical ? " · CRITICAL" : observation.abnormal ? " · ABNORMAL" : "";
  return `${observation.code}: ${value || "not recorded"}${observation.unit ? ` ${observation.unit}` : ""}${severity}`;
}

export function buildAiVisitSummaryInput(visit: AiVisitSummaryVisit): AiVisitSummaryInput {
  const encounter = visit.encounters[0];
  if (!encounter) {
    throw Object.assign(new Error("A signed encounter is required before generating an AI summary"), { status: 409 });
  }
  const subjective = record(encounter.subjective);
  const objective = record(encounter.objective);
  const plan = record(encounter.plan);
  const observations = visit.triage?.observations.map(observationLine) || [];
  const diagnoses = encounter.diagnoses.map((diagnosis) =>
    `${diagnosis.code || "Uncoded"} · ${diagnosis.description} (${diagnosis.type.toLowerCase()})`,
  );
  const investigations = visit.orders.flatMap((order) => {
    if (order.type === "LABORATORY" && order.laboratory?.result?.status === "VERIFIED") {
      const result = order.laboratory.result;
      const items = result.items.map((item) =>
        `${item.analyte} ${item.value}${item.unit ? ` ${item.unit}` : ""}${item.referenceRange ? ` (reference ${item.referenceRange})` : ""}${item.flag ? ` [${item.flag}]` : ""}`,
      );
      return [`${order.displayName}: ${items.join("; ") || result.reportText || "verified result recorded"}`];
    }
    if (order.type === "IMAGING" && order.imaging?.result?.status === "VERIFIED") {
      return [`${order.displayName}: ${order.imaging.result.conclusion}`];
    }
    return [];
  });
  const medicines = visit.orders.flatMap((order) => {
    const prescription = order.prescription;
    if (order.type !== "MEDICATION" || !prescription) return [];
    const details = [
      prescription.genericName || order.displayName,
      prescription.strength,
      prescription.dosageForm,
      prescription.dose,
      prescription.route,
      prescription.frequency,
      prescription.duration,
      prescription.instructions,
      `dispensing ${prescription.dispenseStatus.toLowerCase().replaceAll("_", " ")}`,
    ].filter((value): value is string => Boolean(value));
    return [details.join(" · ")];
  });
  const followUp = [
    labelled("Plan", plan.plan),
    labelled("Disposition", plan.disposition),
    text(plan.followUpDate) ? `Follow-up date: ${text(plan.followUpDate)}` : null,
    ...visit.referrals.map((referral) => [
      `Referral ${referral.referralNumber}`,
      referral.urgency,
      referral.reason,
      `to ${referral.receivingFacility}${referral.receivingDepartment ? ` / ${referral.receivingDepartment}` : ""}`,
      referral.appointmentAt ? `appointment ${referral.appointmentAt.toISOString()}` : null,
      referral.feedback ? `feedback ${referral.feedback}` : null,
      `status ${referral.status.toLowerCase().replaceAll("_", " ")}`,
    ].filter((value): value is string => Boolean(value)).join(" · ")),
  ].filter((value): value is string => Boolean(value));
  const safetyInformation = [
    ...visit.patient.allergies.map((allergy) =>
      `Allergy: ${allergy.substance}${allergy.reaction ? ` · reaction ${allergy.reaction}` : ""}${allergy.severity ? ` · severity ${allergy.severity}` : ""}`,
    ),
    ...(visit.triage?.pregnancyStatus ? [`Pregnancy status: ${visit.triage.pregnancyStatus}`] : []),
    ...(visit.triage?.estimatedDeliveryDate
      ? [`Pregnancy dating: LNMP ${visit.triage.lastMenstrualPeriod?.toISOString().slice(0, 10) || "not recorded"} · EDD ${visit.triage.estimatedDeliveryDate.toISOString().slice(0, 10)} · ${visit.triage.gestationalAgeWeeks ?? 0} weeks ${visit.triage.gestationalAgeDays ?? 0} days · source ${visit.triage.pregnancyDatingMethod || "LNMP"}`]
      : []),
    ...(visit.triage?.observations.filter((observation) => observation.abnormal || observation.critical).map(observationLine) || []),
    ...visit.orders.flatMap((order) => order.laboratory?.result?.status === "VERIFIED"
      ? order.laboratory.result.items.filter((item) => item.critical || item.flag).map((item) =>
        `Laboratory flag: ${order.displayName} · ${item.analyte} ${item.value}${item.unit ? ` ${item.unit}` : ""}${item.flag ? ` · ${item.flag}` : ""}${item.critical ? " · CRITICAL" : ""}`,
      )
      : []),
  ];

  return aiVisitSummaryInputSchema.parse({
    context: {
      clinic: visit.clinic,
      visitDate: visit.arrivedAt.toISOString(),
      ageYears: ageAtVisit(visit.patient.dateOfBirth, visit.patient.estimatedAgeYears, visit.arrivedAt),
      sexAtBirth: visit.patient.sexAtBirth,
    },
    complaints: complaintLines(subjective),
    documentedHistory: [
      labelled("History of presenting illness", subjective.historyPresentingIllness),
      labelled("Review of systems", subjective.reviewOfSystems),
      labelled("Past medical history", subjective.pastMedicalHistory),
      labelled("Current medicines", subjective.currentMedicines),
      labelled("Family and social history", subjective.familySocialHistory),
      labelled("General examination", objective.generalExamination),
      labelled("Systemic examination", objective.systemicExamination),
    ].filter((value): value is string => Boolean(value)),
    observations,
    diagnoses,
    investigations,
    medicines,
    followUp,
    safetyInformation,
  });
}
