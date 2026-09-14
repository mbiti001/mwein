import { describe, expect, it } from "vitest";
import { governanceGateDefinitions, governanceReadiness, productionConfigurationReadiness } from "./governance";

describe("release governance", () => {
  it("requires current evidence for every gate", () => {
    const now = new Date("2026-09-11T12:00:00.000Z");
    const evidence = governanceGateDefinitions.map((gate) => ({
      gateCode: gate.code,
      status: "APPROVED",
      owner: gate.ownerRole,
      evidenceReference: `evidence://${gate.code}`,
      approvedAt: new Date("2026-09-10T12:00:00.000Z"),
      reviewDueAt: new Date("2027-09-10T12:00:00.000Z"),
    }));
    expect(governanceReadiness(evidence, now)).toMatchObject({ ready: true, approved: governanceGateDefinitions.length });
    evidence[0].reviewDueAt = new Date("2026-09-10T12:00:00.000Z");
    expect(governanceReadiness(evidence, now).ready).toBe(false);
  });

  it("does not consider incomplete production configuration ready", () => {
    expect(productionConfigurationReadiness({ AUTH_SECRET: "short" })).toMatchObject({ ready: false });
  });
});
