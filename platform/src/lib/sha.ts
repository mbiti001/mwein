export const SHA_DRAFT_CONTRACT = {
  version: "2026-09-09",
  status: "DRAFT_SPECIFICATION",
  notice: "Preparation only. Mwein has not executed these SHA contracts.",
  sources: [
    { part: "A1", name: "Master General Terms & Conditions — Part 1", url: "https://www.sha.go.ke/part-a-master-general-terms-conditions-part1/" },
    { part: "A2", name: "Master General Terms & Conditions — Part 2", url: "https://www.sha.go.ke/part-a-master-general-terms-conditions-part2/" },
    { part: "B1", name: "Primary Healthcare Fund Contract", url: "https://www.sha.go.ke/part-b1-primary-healthcare-fund-contract/" },
    { part: "B2", name: "Social Health Insurance Fund Contract", url: "https://www.sha.go.ke/part-b2-social-health-insurance-fund-contract/" },
    { part: "B3", name: "Emergency, Chronic & Critical Illness Fund Contract", url: "https://www.sha.go.ke/part-b3-emergency-chronic-critical-illness-fund-contract/" },
    { part: "B4", name: "Public Officers Medical Scheme Fund Contract", url: "https://www.sha.go.ke/part-b4-public-officers-medical-scheme-fund-contract/" },
    { part: "ANNEXURES", name: "Provider Contract Annexures", url: "https://www.sha.go.ke/provider-contract-annexures/" },
  ],
  funds: [
    { code: "PHF", contractPart: "B1", name: "Primary Healthcare Fund" },
    { code: "SHIF", contractPart: "B2", name: "Social Health Insurance Fund" },
    { code: "ECCIF", contractPart: "B3", name: "Emergency, Chronic & Critical Illness Fund" },
    { code: "POMSF", contractPart: "B4", name: "Public Officers Medical Scheme Fund" },
  ],
  safeguards: {
    platformConfigurationPrevails: true,
    providerTariffsMustNotBeAssumed: true,
    executionRequiredBeforeActivation: true,
    liveSubmissionDisabled: true,
  },
} as const;

export type ShaFund = (typeof SHA_DRAFT_CONTRACT.funds)[number]["code"];

export type ShaClaimPreparationInput = {
  fund: ShaFund;
  emergency: boolean;
  eligibilityReference?: string;
  referralReference?: string;
  preauthorisationRequired: boolean;
  preauthorisationReference?: string;
  emergencyNotificationReference?: string;
  pomsfEmployerId?: string;
  publicServiceGrade?: string;
};

export type ShaPreparationIssue = {
  code: string;
  message: string;
};

export type ShaContractProfileInput = {
  status?: string | null;
  draftVersion?: string | null;
  contractReference?: string | null;
  facilityFid?: string | null;
  regulatorRegistration?: string | null;
  countyOffice?: string | null;
  effectiveDate?: Date | string | null;
  facilityTier?: string | null;
  enabledFunds?: string[] | null;
  tariffScheduleVersion?: string | null;
  pomsfAccessMatrixVersion?: string | null;
};

const present = (value: string | undefined) => Boolean(value?.trim());

export function shaClaimPreparationIssues(input: ShaClaimPreparationInput): ShaPreparationIssue[] {
  const issues: ShaPreparationIssue[] = [];
  if (!input.emergency && !present(input.eligibilityReference)) {
    issues.push({ code: "ELIGIBILITY_EVIDENCE_PENDING", message: "Record the SHA eligibility verification reference before submission." });
  }
  if (!input.emergency && input.preauthorisationRequired && !present(input.preauthorisationReference)) {
    issues.push({ code: "PREAUTHORISATION_PENDING", message: "Record the SHA pre-authorisation reference before submission." });
  }
  if (input.emergency && !present(input.emergencyNotificationReference)) {
    issues.push({ code: "EMERGENCY_NOTIFICATION_PENDING", message: "Record the SHA emergency notification reference within the contractual notification period." });
  }
  if (input.fund === "SHIF" && !input.emergency && !present(input.referralReference)) {
    issues.push({ code: "REFERRAL_EVIDENCE_PENDING", message: "Record the primary-care referral or applicable access exception before SHIF submission." });
  }
  if (input.fund === "POMSF" && !input.emergency) {
    if (!present(input.pomsfEmployerId)) issues.push({ code: "POMSF_EMPLOYER_PENDING", message: "Record the POMSF employer ID before submission." });
    if (!present(input.publicServiceGrade)) issues.push({ code: "POMSF_GRADE_PENDING", message: "Record the principal member's public-service grade before submission." });
  }
  return issues;
}

export function prepareShaDraftClaim(
  input: ShaClaimPreparationInput,
  context: { emergencyOccurredAt?: Date | string } = {},
) {
  const emergencyOccurredAt = input.emergency
    ? new Date(context.emergencyOccurredAt || new Date())
    : null;
  const emergencyNotificationDueAt = emergencyOccurredAt
    ? new Date(emergencyOccurredAt.getTime() + 24 * 60 * 60 * 1000)
    : null;
  return {
    ...input,
    contractVersion: SHA_DRAFT_CONTRACT.version,
    contractStatus: SHA_DRAFT_CONTRACT.status,
    preparationOnly: true,
    emergencyOccurredAt: emergencyOccurredAt?.toISOString() || null,
    emergencyNotificationDueAt: emergencyNotificationDueAt?.toISOString() || null,
    readinessIssues: shaClaimPreparationIssues(input),
  };
}

export function shaEmergencyNotificationStatus(
  preparation: {
    emergency?: boolean;
    emergencyNotificationReference?: string;
    emergencyNotificationDueAt?: string | null;
  },
  now = new Date(),
) {
  if (!preparation.emergency) return { status: "NOT_APPLICABLE" as const, dueAt: null, remainingMs: null };
  const dueAt = preparation.emergencyNotificationDueAt ? new Date(preparation.emergencyNotificationDueAt) : null;
  if (present(preparation.emergencyNotificationReference)) return { status: "RECORDED" as const, dueAt, remainingMs: dueAt ? dueAt.getTime() - now.getTime() : null };
  const remainingMs = dueAt ? dueAt.getTime() - now.getTime() : null;
  return { status: remainingMs != null && remainingMs < 0 ? "OVERDUE" as const : "DUE" as const, dueAt, remainingMs };
}

function enabledFunds() {
  const valid = new Set<ShaFund>(SHA_DRAFT_CONTRACT.funds.map((fund) => fund.code));
  return (process.env.SHA_ENABLED_FUNDS || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is ShaFund => valid.has(value as ShaFund));
}

export function shaContractProfileReadiness(profile: ShaContractProfileInput | null | undefined) {
  const funds = (profile?.enabledFunds || []).filter((value): value is ShaFund =>
    SHA_DRAFT_CONTRACT.funds.some((fund) => fund.code === value),
  );
  const checks = {
    draftSpecificationLoaded: true,
    contractExecuted: profile?.status === "EXECUTED",
    contractReference: present(profile?.contractReference || undefined),
    facilityFid: present(profile?.facilityFid || undefined),
    regulatorRegistration: present(profile?.regulatorRegistration || undefined),
    countyOffice: present(profile?.countyOffice || undefined),
    effectiveDate: Boolean(profile?.effectiveDate),
    facilityTier: present(profile?.facilityTier || undefined),
    enabledFunds: funds.length > 0,
    tariffScheduleVersion: present(profile?.tariffScheduleVersion || undefined),
  };
  const activationReady = Object.values(checks).every(Boolean);
  return {
    phase: activationReady ? "EXECUTED_CONFIGURATION_COMPLETE" : "DRAFT_PREPARATION",
    activationReady,
    draftVersion: profile?.draftVersion || SHA_DRAFT_CONTRACT.version,
    enabledFunds: funds,
    checks,
  };
}

export function shaContractReadiness() {
  return shaContractProfileReadiness({
    status: process.env.SHA_CONTRACT_STATUS,
    draftVersion: SHA_DRAFT_CONTRACT.version,
    contractReference: process.env.SHA_CONTRACT_REFERENCE,
    facilityFid: process.env.SHA_FACILITY_FID,
    regulatorRegistration: process.env.SHA_REGULATOR_REGISTRATION,
    countyOffice: process.env.SHA_COUNTY_OFFICE,
    effectiveDate: process.env.SHA_CONTRACT_EFFECTIVE_DATE,
    facilityTier: process.env.SHA_FACILITY_TIER,
    enabledFunds: enabledFunds(),
    tariffScheduleVersion: process.env.SHA_TARIFF_SCHEDULE_VERSION,
  });
}

export function shaGatewayReadiness(profile?: ShaContractProfileInput | null) {
  const contract = profile === undefined ? shaContractReadiness() : shaContractProfileReadiness(profile);
  const checks = {
    contractActivated: contract.activationReady,
    transportImplemented: false,
    baseUrl: Boolean(process.env.SHA_FHIR_BASE_URL),
    facilityCode: Boolean(process.env.SHA_FACILITY_CODE),
    clientId: Boolean(process.env.SHA_CLIENT_ID),
    clientSecret: Boolean(process.env.SHA_CLIENT_SECRET),
  };
  return { ready: Object.values(checks).every(Boolean), checks, contract, draftSpecification: SHA_DRAFT_CONTRACT };
}
