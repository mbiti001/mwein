// Read credentials only from the environment. Never log tokens or response bodies.
const clientId = process.env.ICD11_CLIENT_ID?.trim();
const clientSecret = process.env.ICD11_CLIENT_SECRET?.trim();
const release = process.env.ICD11_RELEASE?.trim() || "2026-01";
try {
  if (!clientId || !clientSecret) throw new Error("Set ICD11_CLIENT_ID and ICD11_CLIENT_SECRET in the server environment");
  if (!/^\d{4}-\d{2}$/.test(release)) throw new Error("ICD11_RELEASE must use YYYY-MM");
  const tokenResponse = await fetch("https://icdaccessmanagement.who.int/connect/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "icdapi_access", grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenResponse.ok) throw new Error(`WHO authentication returned HTTP ${tokenResponse.status}`);
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error("WHO authentication returned no token");
  const url = new URL(`https://id.who.int/icd/release/11/${release}/mms/search`);
  url.search = new URLSearchParams({ q: "cholera", useFlexisearch: "true", flatResults: "true" }).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}`, "API-Version": "v2", "Accept-Language": "en", Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`WHO MMS search returned HTTP ${response.status}`);
  const data = await response.json();
  const coded = (data.destinationEntities || []).filter(item => item.theCode && item.title);
  if (!coded.length) throw new Error("WHO returned no coded results for the fixed terminology check");
  for (const item of coded.slice(0, 12)) {
    const uri = new URL(item.id || item.linearizationUri);
    if (uri.hostname !== "id.who.int" || !uri.pathname.startsWith(`/icd/release/11/${release}/mms/`)) throw new Error("WHO result did not identify the selected MMS release");
  }
  console.log(JSON.stringify({ status: "verified", provider: "WHO ICD API", apiVersion: "v2", release, language: "en", codedResults: coded.length, checkedAt: new Date().toISOString(), patientDataSent: false }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "WHO connection verification failed");
  process.exitCode = 1;
}
