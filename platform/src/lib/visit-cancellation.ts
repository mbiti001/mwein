import { z } from "zod";
import { documentDefinitions, documentKinds } from "./clinic-documents";

export const SHA_CANCELLATION_POLICY_VERSION = "SHA-OFFICIAL-REVIEW-2026-09-19";

export const visitCancellationReasons = [
  { code: "PATIENT_REQUEST", label: "Patient requested cancellation" },
  { code: "PATIENT_LEFT_BEFORE_CARE", label: "Patient left before care" },
  { code: "OVERDUE_UNPROCESSED", label: "Overdue unprocessed visit — attendance reviewed" },
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

export const visitCancellationReasonSchema = z.enum(cancellationReasonCodes);

export type VisitCancellationPreview = {
  visitId: string;
  visitNumber: string;
  patient: { id: string; fullName: string; patientNumber: string };
  status: string;
  canCancel: boolean;
  blockers: string[];
  overdueEligible: boolean;
  emergencyCare: boolean;
  impact: {
    activeQueues: number;
    pendingOrders: number;
    draftClaims: number;
    voidInvoice: boolean;
    cancelAppointment: boolean;
  };
};

export const visitCancellationSchema = z.object({
  reasonCode: visitCancellationReasonSchema,
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
  clinicallyClosedAt?: Date | string | null;
  clinic: string;
  visitType?: string | null;
  priority: string;
  encounters: Array<{ status: string }>;
  clinicDocuments?: Array<{ status: string; kind: string }>;
  orders: Array<{ status: string; displayName?: string }>;
  invoice?: null | {
    status: string;
    payments: Array<{ status: string }>;
    claims: Array<{ status: string }>;
  };
};

export function isEmergencyCancellationVisit(visit: Pick<CancellableVisit, "clinic" | "visitType" | "priority">) {
  return [visit.clinic, visit.visitType].some((value) => value?.toLowerCase().includes("emergency"))
    || ["URGENT", "EMERGENCY"].includes(visit.priority);
}

export function visitCancellationBlockers(visit: CancellableVisit, reasonCode: string) {
  const blockers: string[] = [];
  if (["ADMITTED", "REFERRED", "DISCHARGED", "COMPLETED", "CANCELLED"].includes(visit.status))
    blockers.push(`A visit that is ${visit.status.toLowerCase()} cannot be cancelled`);
  else if (visit.clinicallyClosedAt)
    blockers.push("Clinical closure is already recorded; use the clinical correction and billing workflows");
  if (visit.encounters.some((encounter) => ["SIGNED", "CORRECTED"].includes(encounter.status)))
    blockers.push("The clinical consultation is already signed; use the clinical correction and completion workflow");
  if (visit.clinicDocuments?.some((document) => document.status === "SIGNED"
    && documentKinds.some(kind => kind === document.kind && documentDefinitions[kind].clinical)))
    blockers.push("A linked clinical document is already signed; review the signed record and use clinical closure or correction");
  if (visit.orders.some(order => order.status === "IN_PROGRESS")) blockers.push("Care is in progress; resolve the service before considering cancellation");
  // Cancellation authority does not grant access to the names or results of clinical services.
  if (visit.orders.some((order) => order.status === "COMPLETED"))
    blockers.push("Completed care cannot be voided; use clinical closure and the controlled billing workflow");
  if (visit.invoice?.payments.some((payment) => payment.status === "PENDING"))
    blockers.push("A payment is pending; resolve it through the billing workflow before cancellation");
  if (visit.invoice?.payments.some((payment) => payment.status === "CONFIRMED") || ["PART_PAID", "PAID"].includes(visit.invoice?.status || ""))
    blockers.push("A confirmed payment exists; reverse it through the controlled billing workflow first");
  if (visit.invoice?.claims.some((claim) => !["DRAFT", "CANCELLED"].includes(claim.status)))
    blockers.push("A claim has already left draft state; resolve it through the claims workflow first");

  if (["SHA_BENEFIT_OR_ELIGIBILITY", "PRIVATE_COVER_NOT_AVAILABLE"].includes(reasonCode) && isEmergencyCancellationVisit(visit))
    blockers.push("Do not delay or cancel urgent or emergency care because of a cover eligibility or benefit outcome; arrange clinical assessment and stabilisation");
  return blockers;
}
