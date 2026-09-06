import { afterEach, describe, expect, it } from "vitest";
import { integrationReadiness } from "./integrations";

const originalClientId = process.env.ICD11_CLIENT_ID;
const originalClientSecret = process.env.ICD11_CLIENT_SECRET;

afterEach(() => {
  process.env.ICD11_CLIENT_ID = originalClientId;
  process.env.ICD11_CLIENT_SECRET = originalClientSecret;
});

describe("external integration readiness", () => {
  it("keeps certified transmission channels on hold", () => {
    const readiness = integrationReadiness();
    expect(readiness.find(item => item.key === "sha")?.state).toBe("PREPARED_ON_HOLD");
    expect(readiness.find(item => item.key === "khis")?.state).toBe("PREPARED_ON_HOLD");
    expect(readiness.find(item => item.key === "analyser")?.state).toBe("PREPARED_ON_HOLD");
  });

  it("only reports the WHO ICD API available when both credentials exist", () => {
    delete process.env.ICD11_CLIENT_ID;
    delete process.env.ICD11_CLIENT_SECRET;
    expect(integrationReadiness().find(item => item.key === "icd11")?.state).toBe("NOT_CONFIGURED");
    process.env.ICD11_CLIENT_ID = "client";
    process.env.ICD11_CLIENT_SECRET = "secret";
    expect(integrationReadiness().find(item => item.key === "icd11")?.state).toBe("AVAILABLE");
  });
});
