import { describe, expect, it } from "vitest";
import { kenyaFhirConfiguration, toKenyaCorePatient } from "./kenya-fhir";

const configuration = { coreVersion: "1.0.0", patientProfile: "https://dha.example/StructureDefinition/approved-patient", patientIdentifierSystem: "https://dha.example/identifier/patient", facilityIdentifierSystem: "https://dha.example/identifier/facility" };

describe("Kenya FHIR preparation boundary", () => {
  it("fails closed until approved canonical systems are configured", () => {
    expect(kenyaFhirConfiguration({ KENYA_CORE_VERSION: "1.0.0" })).toBeNull();
    expect(kenyaFhirConfiguration({ KENYA_CORE_VERSION: "1.0.0", KENYA_CORE_PATIENT_PROFILE: configuration.patientProfile, KENYA_PATIENT_IDENTIFIER_SYSTEM: configuration.patientIdentifierSystem, KENYA_FACILITY_IDENTIFIER_SYSTEM: configuration.facilityIdentifierSystem })).toEqual(configuration);
  });
  it("builds a profiled FHIR R4 Patient without contact data", () => {
    const resource = toKenyaCorePatient({ id: "patient-id", patientNumber: "MMS-2026-1", givenName: "Amina", familyName: "Wekesa", fullName: "Amina Wekesa", sexAtBirth: "FEMALE", dateOfBirth: "1990-01-02", identityStatus: "ASSERTED", facility: { code: "MMS" } }, configuration);
    expect(resource).toMatchObject({ resourceType: "Patient", meta: { profile: [configuration.patientProfile] }, gender: "female", birthDate: "1990-01-02" });
    expect(JSON.stringify(resource)).not.toContain("phone");
    expect(resource.identifier).toEqual([{ system: configuration.patientIdentifierSystem, value: "MMS-2026-1" }]);
    expect(resource.identifier.some(item => item.value === "MMS" || item.system === configuration.facilityIdentifierSystem)).toBe(false);
  });
  it("blocks exchange of an unreconciled emergency identity", () => {
    expect(() => toKenyaCorePatient({ id: "patient-id", patientNumber: "MMS-2026-2", fullName: "Unidentified patient", sexAtBirth: "UNKNOWN", identityStatus: "UNIDENTIFIED", facility: { code: "MMS" } }, configuration)).toThrow("identity reconciliation");
  });
});
