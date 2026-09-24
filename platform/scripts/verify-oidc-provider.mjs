const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, "");
const redirectUri = process.env.OIDC_REDIRECT_URI;
if (!issuer || !redirectUri) {
  console.error("Set OIDC_ISSUER and OIDC_REDIRECT_URI before validating the provider");
  process.exit(2);
}
if (!issuer.startsWith("https://") || !redirectUri.startsWith("https://")) throw new Error("OIDC issuer and redirect URI must use HTTPS");

const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`OIDC discovery failed with HTTP ${response.status}`);
const discovery = await response.json();
const requiredHttps = ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"];
for (const field of requiredHttps) {
  if (typeof discovery[field] !== "string" || !discovery[field].startsWith("https://")) throw new Error(`OIDC discovery is missing secure ${field}`);
}
if (discovery.issuer.replace(/\/$/, "") !== issuer) throw new Error("OIDC discovery issuer does not exactly match OIDC_ISSUER");
if (!discovery.response_types_supported?.includes("code")) throw new Error("OIDC provider does not advertise authorization-code flow");
if (!discovery.code_challenge_methods_supported?.includes("S256")) throw new Error("OIDC provider does not advertise PKCE S256");
const jwks = await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(15_000) });
if (!jwks.ok || !Array.isArray((await jwks.json()).keys)) throw new Error("OIDC JWKS endpoint is unavailable or invalid");
console.log(JSON.stringify({ issuer: discovery.issuer, authorizationCode: true, pkceS256: true, jwks: "verified", endSessionEndpoint: Boolean(discovery.end_session_endpoint) }, null, 2));
