import { z } from "zod";

export const SHA_CANCELLATION_POLICY_VERSION = "SHA-OFFICIAL-REVIEW-2026-09-19";

export const visitCancellationReasons = [
  { code: "PATIENT_REQUEST", label: "Patient requested cancellation" },
  { code: "PATIENT_LEFT_BEFORE_CARE", label: "Patient left before care" },
  { code: "DUPLICATE_VISIT", label: "Duplicate visit" },
  { code: "WRONG_PATIENT", label: "Visit opened for the wrong patient" },
  { code: "CLINIC_UNAVAILABLE", label: "Clinic unavailable" },
  { code: "SERVICE_UNAVAILABLE", label: "Required service unavailable" },
  { code: "CLINICAL_REDIRECTION", label: "Redirected to another care setting" },
  { code: "SHA_BENEFIT_OR_ELIGIBILITY", label: "SHA eligibility or benefit outcome" },
  { code: "PRIVATE_COVER_NOT_AVAILABLE", label: "Other cover unavailable" },
  { code: "CREATED_IN_ERROR", label: "Visit created in error" },
  { code: "OTHER", label: "Other documented reason" },
] as const;

export const shaCancellationOutcomes = [
  { code: "COVERAGE_INACTIVE", label: "Coverage inactive" },
  { code: "BENEFIT_NOT_COVERED", label: "Service is not in the available benefit" },
  { code: "BENEFIT_LIMIT_REACHED", label: "Benefit limit reached" },
  { code: "WAITING_PERIOD", label: "Waiting period applies" },
  { code: "REFERRAL_REQUIRED", label: "Referral required" },
  { code: "PRIOR_AUTHORIZATION_REQUIRED", label: "Prior authorisation required" },
  { code: "NETWORK_RESTRICTION", label: "Provider network restriction" },
  { code: "VERIFICATION_UNAVAILABLE", label: "Eligibility verification unavailable" },
] as const;

export function visitCancellationReasonLabel(code: string) {
  return visitCancellationReasons.find((reason) => reason.code === code)?.label || code.replaceAll("_", " ");
}

const cancellationReasonCodes = visitCancellationReasons.map((reason) => reason.code) as [
  (typeof visitCancellationReasons)[number]["code"],
  ...(typeof visitCancellationReasons)[number]["code"][],
];
const shaOutcomeCodes = shaCancellationOutcomes.map((outcome) => outcome.code) as [
  (typeof shaCancellationOutcomes)[number]["code"],
  ...(typeof shaCancellationOutcomes)[number]["code"][],
];

export const visitCancellationSchema = z.object({
  reasonCode: z.enum(cancellationReasonCodes),
  details: z.string().trim().min(5, "Explain why the visit is being cancelled").max(500),
  shaOutcome: z.enum(shaOutcomeCodes).optional(),
  shaEligibilityReference: z.string().trim().min(3).max(120).optional(),
}).superRefine((value, context) => {
  if (value.reasonCode === "SHA_BENEFIT_OR_ELIGIBILITY") {
    if (!value.shaOutcome)
      context.addIssue({ code: "custom", path: ["shaOutcome"], message: "Record the SHA eligibility or benefit outcome" });
    if (!value.shaEligibilityReference)
      context.addIssue({ code: "custom", path: ["shaEligibilityReference"], message: "Enter the SHA check or manual verification reference" });
  } else if (value.shaOutcome || value.shaEligibilityReference) {
    context.addIssue({ code: "custom", path: ["reasonCode"], message: "SHA outcome details can only be recorded for a SHA eligibility or benefit cancellation" });
  }
});

type CancellableVisit = {
  status: string;
  clinic: string;
  visitType?: string | null;
  priority: string;
  encounters: Array<{ status: string }>;
  orders: Array<{ status: string; displayName?: string }>;
  invoice?: null | {
    status: string;
    payments: Array<{ status: string }>;
    claims: Array<{ status: string }>;
  };
};

export function visitCancellationBlockers(visit: CancellableVisit, reasonCode: string) {
  const blockers: string[] = [];
  if (["ADMITTED", "REFERRED", "DISCHARGED", "COMPLETED", "CANCELLED"].includes(visit.status))
    blockers.push(`A visit that is ${visit.status.toLowerCase()} cannot be cancelled`);
  if (visit.encounters.some((encounter) => ["SIGNED", "CORRECTED"].includes(encounter.status)))
    blockers.push("The clinical consultation is already signed; use the clinical correction and completion workflow");
  const completedOrders = visit.orders.filter((order) => order.status === "COMPLETED");
  if (completedOrders.length)
    blockers.push(`Completed care cannot be voided (${completedOrders.map((order) => order.displayName || "service").join(", ")})`);
  if (visit.invoice?.payments.some((payment) => payment.status === "CONFIRMED") || visit.invoice?.status === "PAID")
    blockers.push("A confirmed payment exists; reverse it through the controlled billing workflow first");
  if (visit.invoice?.claims.some((claim) => ["SUBMITTED", "APPROVED", "PAID"].includes(claim.status)))
    blockers.push("A claim has already left draft state; resolve it through the claims workflow first");

  const emergencyCare = [visit.clinic, visit.visitType].some((value) => value?.toLowerCase().includes("emergency"))
    || ["URGENT", "EMERGENCY"].includes(visit.priority);
  if (reasonCode === "SHA_BENEFIT_OR_ELIGIBILITY" && emergencyCare)
    blockers.push("Do not delay or cancel urgent or emergency care because of a SHA eligibility or benefit outcome; arrange clinical assessment and stabilisation");
  return blockers;
}
