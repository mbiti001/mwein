import { describe, expect, it } from "vitest";
import { shaClaimPreflight, type ShaClaimPreflightContext } from "./sha-claim-preflight";

const context: ShaClaimPreflightContext = {
  patientShaNumber: "SHA-100",
  memberNumber: "SHA-100",
  signedEncounter: true,
  codedDiagnosis: true,
  unresolvedOrderCount: 0,
  selectedLineCount: 2,
  invalidLineCount: 0,
  duplicateLineCount: 0,
  contractReady: false,
  gatewayReady: false,
};

describe("SHA claim preflight", () => {
  it("allows a complete preparation draft while keeping live submission on external hold", () => {
    const result = shaClaimPreflight({
      fund: "PHF",
      emergency: false,
      preauthorisationRequired: false,
      eligibilityReference: "ELIG-1",
    }, context);
    expect(result.draftReady).toBe(true);
    expect(result.submissionReady).toBe(false);
    expect(result.actionCount).toBe(0);
    expect(result.externalHoldCount).toBe(2);
    expect(result.mode).toBe("DRAFT_PREPARATION");
  });

  it("blocks a draft when its patient and clinical foundation is incomplete", () => {
    const result = shaClaimPreflight({ fund: "PHF", emergency: false, preauthorisationRequired: false }, {
      ...context,
      patientShaNumber: null,
      signedEncounter: false,
      codedDiagnosis: false,
      unresolvedOrderCount: 2,
      selectedLineCount: 0,
    });
    expect(result.draftReady).toBe(false);
    expect(result.actionCount).toBeGreaterThanOrEqual(6);
  });

  it("never delays emergency preparation for eligibility, referral or pre-authorisation", () => {
    const result = shaClaimPreflight({ fund: "ECCIF", emergency: true, preauthorisationRequired: true }, context);
    for (const code of ["ELIGIBILITY_REFERENCE", "REFERRAL_REFERENCE", "PREAUTHORISATION_REFERENCE"]) {
      expect(result.checks.find((item) => item.code === code)?.status).toBe("NOT_APPLICABLE");
    }
    expect(result.checks.find((item) => item.code === "EMERGENCY_NOTIFICATION_REFERENCE")?.status).toBe("ACTION_REQUIRED");
  });

  it("shows the additional POMSF identity evidence without hiding the common checks", () => {
    const result = shaClaimPreflight({
      fund: "POMSF",
      emergency: false,
      preauthorisationRequired: false,
      eligibilityReference: "ELIG-1",
    }, context);
    expect(result.checks.find((item) => item.code === "POMSF_EMPLOYER_ID")?.status).toBe("ACTION_REQUIRED");
    expect(result.checks.find((item) => item.code === "POMSF_GRADE")?.status).toBe("ACTION_REQUIRED");
    expect(result.checks.find((item) => item.code === "SIGNED_ENCOUNTER")?.status).toBe("READY");
  });
});
