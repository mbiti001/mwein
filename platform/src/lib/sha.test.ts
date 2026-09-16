import { afterEach, describe, expect, it } from "vitest";
import {
  prepareShaDraftClaim,
  SHA_DRAFT_CONTRACT,
  shaClaimPreparationIssues,
  shaContractProfileReadiness,
  shaContractReadiness,
  shaEmergencyNotificationStatus,
  shaGatewayReadiness,
} from "./sha";

const contractEnvironmentKeys = [
  "SHA_CONTRACT_STATUS",
  "SHA_CONTRACT_REFERENCE",
  "SHA_FACILITY_FID",
  "SHA_REGULATOR_REGISTRATION",
  "SHA_COUNTY_OFFICE",
  "SHA_CONTRACT_EFFECTIVE_DATE",
  "SHA_FACILITY_TIER",
  "SHA_ENABLED_FUNDS",
  "SHA_TARIFF_SCHEDULE_VERSION",
] as const;

const originalEnvironment = Object.fromEntries(contractEnvironmentKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of contractEnvironmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("SHA integration guardrail", () => {
  it("cannot report ready before authenticated transport is implemented", () => {
    expect(shaGatewayReadiness().ready).toBe(false);
    expect(shaGatewayReadiness().checks.transportImplemented).toBe(false);
  });

  it("models the complete published draft contract without activating it", () => {
    expect(SHA_DRAFT_CONTRACT.sources.map((source) => source.part)).toEqual(["A1", "A2", "B1", "B2", "B3", "B4", "ANNEXURES"]);
    expect(SHA_DRAFT_CONTRACT.funds.map((fund) => fund.code)).toEqual(["PHF", "SHIF", "ECCIF", "POMSF"]);
    expect(shaContractReadiness().phase).toBe("DRAFT_PREPARATION");
    expect(shaContractReadiness().activationReady).toBe(false);
  });

  it("does not activate a contract until all provider-specific values are confirmed", () => {
    process.env.SHA_CONTRACT_STATUS = "EXECUTED";
    process.env.SHA_CONTRACT_REFERENCE = "CN-TEST";
    process.env.SHA_FACILITY_FID = "FID-TEST";
    process.env.SHA_REGULATOR_REGISTRATION = "COC-TEST";
    process.env.SHA_COUNTY_OFFICE = "TEST";
    process.env.SHA_CONTRACT_EFFECTIVE_DATE = "2026-10-01";
    process.env.SHA_FACILITY_TIER = "TEST-TIER";
    process.env.SHA_ENABLED_FUNDS = "PHF,SHIF";
    expect(shaContractReadiness().activationReady).toBe(false);
    process.env.SHA_TARIFF_SCHEDULE_VERSION = "SIGNED-TEST";
    expect(shaContractReadiness().activationReady).toBe(true);
  });

  it("records readiness gaps on a preparation-only POMSF claim", () => {
    const input = { fund: "POMSF" as const, emergency: false, preauthorisationRequired: true };
    expect(shaClaimPreparationIssues(input).map((issue) => issue.code)).toEqual([
      "ELIGIBILITY_EVIDENCE_PENDING",
      "PREAUTHORISATION_PENDING",
      "POMSF_EMPLOYER_PENDING",
      "POMSF_GRADE_PENDING",
    ]);
    expect(prepareShaDraftClaim(input)).toMatchObject({
      contractVersion: "2026-09-09",
      contractStatus: "DRAFT_SPECIFICATION",
      preparationOnly: true,
    });
  });

  it("uses the emergency notification evidence instead of blocking treatment on prior verification", () => {
    expect(shaClaimPreparationIssues({ fund: "ECCIF", emergency: true, preauthorisationRequired: true })).toEqual([
      expect.objectContaining({ code: "EMERGENCY_NOTIFICATION_PENDING" }),
    ]);
  });

  it("calculates and tracks the emergency notification deadline", () => {
    const prepared = prepareShaDraftClaim(
      { fund: "ECCIF", emergency: true, preauthorisationRequired: false },
      { emergencyOccurredAt: "2026-09-16T08:00:00.000Z" },
    );
    expect(prepared.emergencyNotificationDueAt).toBe("2026-09-17T08:00:00.000Z");
    expect(shaEmergencyNotificationStatus(prepared, new Date("2026-09-17T07:00:00.000Z")).status).toBe("DUE");
    expect(shaEmergencyNotificationStatus(prepared, new Date("2026-09-17T09:00:00.000Z")).status).toBe("OVERDUE");
    expect(shaEmergencyNotificationStatus({ ...prepared, emergencyNotificationReference: "SHA-EM-1" }).status).toBe("RECORDED");
  });

  it("evaluates a stored facility contract profile independently of environment variables", () => {
    expect(shaContractProfileReadiness({
      status: "EXECUTED",
      contractReference: "CN-1",
      facilityFid: "FID-1",
      regulatorRegistration: "COC-1",
      countyOffice: "KAKAMEGA",
      effectiveDate: "2026-10-01",
      facilityTier: "TIER-1",
      enabledFunds: ["PHF", "SHIF"],
      tariffScheduleVersion: "SIGNED-1",
    }).activationReady).toBe(true);
  });
});
