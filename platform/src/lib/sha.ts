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
