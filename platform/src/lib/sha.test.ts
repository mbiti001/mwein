import { describe, expect, it } from "vitest";
import { assessShaRoute, shaClaimDeadline, shaGatewayReadiness } from "./sha";

describe("SHA integration guardrail", () => {
  it("cannot report ready before authenticated transport is implemented", () => {
    expect(shaGatewayReadiness().ready).toBe(false);
    expect(shaGatewayReadiness().checks.transportImplemented).toBe(false);
  });
});

describe("SHA benefit routing", () => {
  it("calculates the contractual seven-day submission deadline", () => {
    expect(shaClaimDeadline(new Date("2026-09-01T10:00:00Z")).toISOString()).toBe("2026-09-08T23:59:59.999Z");
  });

  it("blocks a claim without verification, service approval, or required authorisation", () => {
    const result = assessShaRoute({
      fund: "SHIF",
      eligibilityVerified: false,
      facilityServiceApproved: false,
      requiresAuthorization: true,
      serviceDate: new Date("2026-09-10T00:00:00Z"),
      now: new Date("2026-09-12T00:00:00Z"),
    });
    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(3);
  });

  it("warns that POMSF follows applicable SHIF benefits", () => {
    const result = assessShaRoute({
      fund: "POMSF",
      eligibilityVerified: true,
      facilityServiceApproved: true,
      requiresAuthorization: false,
      serviceDate: new Date("2026-09-10T00:00:00Z"),
      now: new Date("2026-09-12T00:00:00Z"),
    });
    expect(result.ready).toBe(true);
    expect(result.warnings.join(" ")).toContain("SHIF");
  });
});
