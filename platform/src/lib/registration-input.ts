// Blank registration fields mean unavailable information, not an observed value.
// Keep supplied values intact for the server schema to validate (including age "0").
const optionalRegistrationFields = [
  "givenName", "middleName", "familyName", "fullName", "dateOfBirth", "estimatedAgeYears",
  "phone", "alternativePhone", "nationalId", "shaNumber", "county", "subcounty", "ward", "village",
  "representativeName", "representativeRelationship", "emergencyReason",
] as const;

export function registrationFormPayload(form: FormData): Record<string, FormDataEntryValue | boolean> {
  const body: Record<string, FormDataEntryValue | boolean> = Object.fromEntries(form.entries());
  for (const field of optionalRegistrationFields) {
    const value = body[field];
    if (typeof value === "string" && value.trim() === "") delete body[field];
  }
  for (const field of ["treatmentConsent", "electronicRecordConsent", "messagingConsent"]) {
    body[field] = form.get(field) === "on";
  }
  return body;
}
