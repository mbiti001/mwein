export function shaGatewayReadiness() {
  const checks = {
    transportImplemented: false,
    baseUrl: Boolean(process.env.SHA_FHIR_BASE_URL),
    facilityCode: Boolean(process.env.SHA_FACILITY_CODE),
    clientId: Boolean(process.env.SHA_CLIENT_ID),
    clientSecret: Boolean(process.env.SHA_CLIENT_SECRET),
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}

export const shaFunds = ["PHCF", "SHIF", "ECCIF", "POMSF"] as const;
export type ShaFund = (typeof shaFunds)[number];

export const shaFundLabels: Record<ShaFund, string> = {
  PHCF: "Primary Healthcare Fund (B1)",
  SHIF: "Social Health Insurance Fund (B2)",
  ECCIF: "Emergency, Chronic & Critical Illness Fund (B3)",
  POMSF: "Public Officers Medical Scheme Fund (B4)",
};

export type ShaRoutingInput = {
  fund: ShaFund;
  eligibilityVerified: boolean;
  facilityServiceApproved: boolean;
  requiresAuthorization: boolean;
  authorizationReference?: string;
  serviceDate: Date;
  now?: Date;
};

export function shaClaimDeadline(serviceDate: Date) {
  const deadline = new Date(serviceDate);
  deadline.setUTCDate(deadline.getUTCDate() + 7);
  deadline.setUTCHours(23, 59, 59, 999);
  return deadline;
}

export function assessShaRoute(input: ShaRoutingInput) {
  const deadline = shaClaimDeadline(input.serviceDate);
  const now = input.now ?? new Date();
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.eligibilityVerified) blockers.push("Verify beneficiary eligibility on the SHA platform");
  if (!input.facilityServiceApproved) blockers.push("Confirm this service line is activated for the facility");
  if (input.requiresAuthorization && !input.authorizationReference?.trim()) blockers.push("Record the required pre-authorisation reference");
  if (now > deadline) blockers.push("The seven-day claim submission window has passed");
  if (input.fund === "POMSF") warnings.push("Charge applicable SHIF benefits before accessing POMSF limits");
  if (input.fund === "PHCF") warnings.push("Covered primary-care services must not be charged to the beneficiary");
  warnings.push("A pre-authorisation does not by itself guarantee payment");
  return { ready: blockers.length === 0, blockers, warnings, deadline };
}
