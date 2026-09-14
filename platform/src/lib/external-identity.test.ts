import { describe, expect, it } from "vitest";
import { externalIdentityConfiguration, mappedRoleCodes, normalizeProviderGroup } from "./external-identity";

describe("external identity boundary", () => {
  it("fails closed until every OIDC setting is present", () => {
    expect(externalIdentityConfiguration({ OIDC_ISSUER: "https://identity.example" }).configured).toBe(false);
    expect(externalIdentityConfiguration({ OIDC_ISSUER: "https://identity.example", OIDC_CLIENT_ID: "mwein", OIDC_CLIENT_SECRET: "a-secure-secret-value", OIDC_REDIRECT_URI: "https://app.example/api/auth/oidc/callback" }).configured).toBe(true);
  });

  it("normalizes provider groups and maps only active configured roles", () => {
    expect(normalizeProviderGroup("  Clinic   Nurses ")).toBe("clinic nurses");
    expect(mappedRoleCodes(["Clinic Nurses"], [
      { providerGroup: "clinic nurses", roleCode: "NURSE", active: true },
      { providerGroup: "clinic nurses", roleCode: "SYSTEM_ADMIN", active: false },
    ])).toEqual(["NURSE"]);
  });
});
