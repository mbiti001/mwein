export type IdentityEnvironment = Record<string, string | undefined>;

export function externalIdentityConfiguration(environment: IdentityEnvironment = process.env) {
  const issuer = environment.OIDC_ISSUER?.trim() || "";
  const clientId = environment.OIDC_CLIENT_ID?.trim() || "";
  const clientSecret = environment.OIDC_CLIENT_SECRET?.trim() || "";
  const redirectUri = environment.OIDC_REDIRECT_URI?.trim() || "";
  const configured = Boolean(
    issuer.startsWith("https://") && clientId && clientSecret.length >= 16 && redirectUri.startsWith("https://"),
  );
  return {
    configured,
    issuer: issuer || null,
    redirectUri: redirectUri || null,
    checks: [
      { code: "OIDC_ISSUER", ready: issuer.startsWith("https://") },
      { code: "OIDC_CLIENT_ID", ready: Boolean(clientId) },
      { code: "OIDC_CLIENT_SECRET", ready: clientSecret.length >= 16 },
      { code: "OIDC_REDIRECT_URI", ready: redirectUri.startsWith("https://") },
    ],
  };
}

export function normalizeProviderGroup(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function mappedRoleCodes(groups: string[], mappings: { providerGroup: string; roleCode: string; active: boolean }[]) {
  const normalized = new Set(groups.map(normalizeProviderGroup));
  return [...new Set(mappings.filter((mapping) => mapping.active && normalized.has(normalizeProviderGroup(mapping.providerGroup))).map((mapping) => mapping.roleCode))];
}
