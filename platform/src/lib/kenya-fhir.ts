export type KenyaFhirConfiguration = {
  coreVersion: string;
  patientProfile: string;
  patientIdentifierSystem: string;
  facilityIdentifierSystem: string;
};

export function kenyaFhirConfiguration(environment: Record<string, string | undefined> = process.env): KenyaFhirConfiguration | null {
  const configuration = {
    coreVersion: environment.KENYA_CORE_VERSION?.trim() || "",
    patientProfile: environment.KENYA_CORE_PATIENT_PROFILE?.trim() || "",
    patientIdentifierSystem: environment.KENYA_PATIENT_IDENTIFIER_SYSTEM?.trim() || "",
    facilityIdentifierSystem: environment.KENYA_FACILITY_IDENTIFIER_SYSTEM?.trim() || "",
  };
  return configuration.coreVersion && Object.values(configuration).slice(1).every((value) => value.startsWith("https://")) ? configuration : null;
}

type ExchangePatient = {
  id: string; patientNumber: string; givenName?: string | null; middleName?: string | null; familyName?: string | null;
  fullName: string; sexAtBirth: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN"; dateOfBirth?: Date | string | null;
  identityStatus: string; facility: { code: string };
  addresses?: { county: string; subcounty: string; ward?: string | null; village?: string | null }[];
};

export function toKenyaCorePatient(patient: ExchangePatient, configuration: KenyaFhirConfiguration) {
  if (patient.identityStatus === "UNIDENTIFIED") throw new Error("Unidentified emergency records cannot be exchanged until identity reconciliation");
  const address = patient.addresses?.[0];
  const gender = patient.sexAtBirth === "FEMALE" ? "female" : patient.sexAtBirth === "MALE" ? "male" : "unknown";
  return {
    resourceType: "Patient", id: patient.id,
    meta: { profile: [configuration.patientProfile], tag: [{ system: "https://mweinmedical.co.ke/fhir/release", code: configuration.coreVersion }] },
    identifier: [{ system: configuration.patientIdentifierSystem, value: patient.patientNumber }, { system: configuration.facilityIdentifierSystem, value: patient.facility.code }],
    active: true,
    name: [{ use: "official", text: patient.fullName, family: patient.familyName || undefined, given: [patient.givenName, patient.middleName].filter(Boolean) }],
    gender,
    birthDate: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().slice(0, 10) : undefined,
    address: address ? [{ district: address.subcounty, state: address.county, line: [address.ward, address.village].filter(Boolean) }] : undefined,
  };
}
