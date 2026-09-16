import { z } from "zod";
import { type ShaClaimPreparationInput } from "@/lib/sha";

export const shaClaimPreparationInputSchema = z.object({
  fund: z.enum(["PHF", "SHIF", "ECCIF", "POMSF"]),
  emergency: z.boolean().default(false),
  eligibilityReference: z.string().trim().max(120).optional(),
  referralReference: z.string().trim().max(120).optional(),
  preauthorisationRequired: z.boolean().default(false),
  preauthorisationReference: z.string().trim().max(120).optional(),
  emergencyNotificationReference: z.string().trim().max(120).optional(),
  pomsfEmployerId: z.string().trim().max(120).optional(),
  publicServiceGrade: z.string().trim().max(120).optional(),
});

export const shaClaimPreflightRequestSchema = z.object({
  memberNumber: z.string().trim().min(2).max(100),
  coveredItemIds: z.array(z.uuid()).min(1).max(100),
  shaPreparation: shaClaimPreparationInputSchema,
});

export type ShaClaimCheckStatus = "READY" | "ACTION_REQUIRED" | "EXTERNAL_HOLD" | "NOT_APPLICABLE";
export type ShaClaimCheckGroup = "PATIENT" | "CLINICAL" | "COVERAGE" | "CONTRACT";

export type ShaClaimReadinessCheck = {
  code: string;
  group: ShaClaimCheckGroup;
  label: string;
  status: ShaClaimCheckStatus;
  detail: string;
  blocksDraft: boolean;
};

export type ShaClaimPreflightContext = {
  patientShaNumber?: string | null;
  memberNumber: string;
  signedEncounter: boolean;
  codedDiagnosis: boolean;
  unresolvedOrderCount: number;
  selectedLineCount: number;
  invalidLineCount: number;
  duplicateLineCount: number;
  contractReady: boolean;
  gatewayReady: boolean;
};

const present = (value?: string | null) => Boolean(value?.trim());
const normalized = (value?: string | null) => value?.trim().toUpperCase() || "";

function check(
  code: string,
  group: ShaClaimCheckGroup,
  label: string,
  status: ShaClaimCheckStatus,
  detail: string,
  blocksDraft = false,
): ShaClaimReadinessCheck {
  return { code, group, label, status, detail, blocksDraft };
}

function evidenceCheck(
  code: string,
  label: string,
  ready: boolean,
  readyDetail: string,
  pendingDetail: string,
) {
  return check(code, "COVERAGE", label, ready ? "READY" : "ACTION_REQUIRED", ready ? readyDetail : pendingDetail);
}

export function shaClaimPreflight(
  preparation: ShaClaimPreparationInput,
  context: ShaClaimPreflightContext,
) {
  const hasPatientNumber = present(context.patientShaNumber);
  const memberMatches = hasPatientNumber && normalized(context.patientShaNumber) === normalized(context.memberNumber);
  const validLines = context.selectedLineCount > 0 && context.invalidLineCount === 0 && context.duplicateLineCount === 0;
  const checks: ShaClaimReadinessCheck[] = [
    check(
      "PATIENT_SHA_NUMBER",
      "PATIENT",
      "Patient SHA number",
      hasPatientNumber ? "READY" : "ACTION_REQUIRED",
      hasPatientNumber ? "SHA number is recorded on the patient profile." : "Record the patient's SHA number before preparing the claim.",
      true,
    ),
    check(
      "MEMBER_NUMBER_MATCH",
      "PATIENT",
      "Member number match",
      memberMatches ? "READY" : "ACTION_REQUIRED",
      memberMatches ? "The claim member number matches the patient record." : "The claim member number must match the patient's recorded SHA number.",
      true,
    ),
    check(
      "SIGNED_ENCOUNTER",
      "CLINICAL",
      "Signed clinical encounter",
      context.signedEncounter ? "READY" : "ACTION_REQUIRED",
      context.signedEncounter ? "The clinical encounter is signed and locked." : "A clinician must sign the encounter before this claim can be prepared.",
      true,
    ),
    check(
      "CODED_DIAGNOSIS",
      "CLINICAL",
      "Coded diagnosis",
      context.codedDiagnosis ? "READY" : "ACTION_REQUIRED",
      context.codedDiagnosis ? "A validated coded diagnosis is attached." : "Record a validated coded diagnosis before preparing the claim.",
      true,
    ),
    check(
      "ORDERS_RESOLVED",
      "CLINICAL",
      "Clinical orders resolved",
      context.unresolvedOrderCount === 0 ? "READY" : "ACTION_REQUIRED",
      context.unresolvedOrderCount === 0 ? "All clinical orders are completed or cancelled." : `${context.unresolvedOrderCount} clinical order${context.unresolvedOrderCount === 1 ? " remains" : "s remain"} unresolved.`,
      true,
    ),
    check(
      "CLAIM_LINES",
      "COVERAGE",
      "Claim services",
      validLines ? "READY" : "ACTION_REQUIRED",
      validLines
        ? `${context.selectedLineCount} invoice item${context.selectedLineCount === 1 ? " is" : "s are"} available for this claim.`
        : context.duplicateLineCount
          ? `${context.duplicateLineCount} selected item${context.duplicateLineCount === 1 ? " is" : "s are"} already allocated to an active claim.`
          : context.invalidLineCount
            ? "One or more selected services do not belong to this invoice."
            : "Select at least one service for this claim.",
      true,
    ),
  ];

  if (preparation.emergency) {
    checks.push(
      check("ELIGIBILITY_REFERENCE", "COVERAGE", "Eligibility evidence", "NOT_APPLICABLE", "Emergency care is not delayed for prior eligibility verification."),
      check("REFERRAL_REFERENCE", "COVERAGE", "Referral or access exception", "NOT_APPLICABLE", "Emergency care does not wait for a referral reference."),
      check("PREAUTHORISATION_REFERENCE", "COVERAGE", "Pre-authorisation", "NOT_APPLICABLE", "Emergency care does not wait for prior authorisation."),
      evidenceCheck(
        "EMERGENCY_NOTIFICATION_REFERENCE",
        "Emergency notification",
        present(preparation.emergencyNotificationReference),
        "The SHA emergency-notification reference is recorded.",
        "Record the SHA notification reference within the contractual notification period.",
      ),
    );
  } else {
    checks.push(
      evidenceCheck(
        "ELIGIBILITY_REFERENCE",
        "Eligibility evidence",
        present(preparation.eligibilityReference),
        "The eligibility-verification reference is recorded.",
        "Record the eligibility-verification reference before submission.",
      ),
      preparation.fund === "SHIF"
        ? evidenceCheck(
            "REFERRAL_REFERENCE",
            "Referral or access exception",
            present(preparation.referralReference),
            "The referral or access-exception reference is recorded.",
            "Record the primary-care referral or applicable access exception.",
          )
        : check("REFERRAL_REFERENCE", "COVERAGE", "Referral or access exception", "NOT_APPLICABLE", `Not required by the current ${preparation.fund} preparation path.`),
      preparation.preauthorisationRequired
        ? evidenceCheck(
            "PREAUTHORISATION_REFERENCE",
            "Pre-authorisation",
            present(preparation.preauthorisationReference),
            "The pre-authorisation reference is recorded.",
            "Record the SHA pre-authorisation reference before submission.",
          )
        : check("PREAUTHORISATION_REFERENCE", "COVERAGE", "Pre-authorisation", "NOT_APPLICABLE", "This preparation does not require pre-authorisation."),
      check("EMERGENCY_NOTIFICATION_REFERENCE", "COVERAGE", "Emergency notification", "NOT_APPLICABLE", "This is not an emergency claim."),
    );
  }

  if (preparation.fund === "POMSF" && !preparation.emergency) {
    checks.push(
      evidenceCheck("POMSF_EMPLOYER_ID", "POMSF employer ID", present(preparation.pomsfEmployerId), "The employer ID is recorded.", "Record the employer ID returned by eligibility verification."),
      evidenceCheck("POMSF_GRADE", "Public-service grade", present(preparation.publicServiceGrade), "The principal member's grade is recorded.", "Record the principal member's public-service grade."),
    );
  }

  checks.push(
    check(
      "FACILITY_CONTRACT",
      "CONTRACT",
      "Executed facility contract",
      context.contractReady ? "READY" : "EXTERNAL_HOLD",
      context.contractReady ? "The facility contract configuration is complete." : "Draft preparation only until the facility contract and tariff configuration are executed.",
    ),
    check(
      "SHA_GATEWAY",
      "CONTRACT",
      "Authenticated SHA gateway",
      context.gatewayReady ? "READY" : "EXTERNAL_HOLD",
      context.gatewayReady ? "The authenticated submission gateway is configured." : "Live submission remains disabled until SHA/DHA credentials and conformance approval are available.",
    ),
  );

  const required = checks.filter((item) => item.status !== "NOT_APPLICABLE");
  const readyCount = required.filter((item) => item.status === "READY").length;
  const actionCount = required.filter((item) => item.status === "ACTION_REQUIRED").length;
  const externalHoldCount = required.filter((item) => item.status === "EXTERNAL_HOLD").length;
  return {
    mode: context.gatewayReady ? "LIVE_GATEWAY" as const : "DRAFT_PREPARATION" as const,
    draftReady: !checks.some((item) => item.blocksDraft && item.status !== "READY"),
    submissionReady: required.every((item) => item.status === "READY"),
    readyCount,
    totalCount: required.length,
    actionCount,
    externalHoldCount,
    checks,
  };
}
