export type IntegrationState = "AVAILABLE" | "PREPARED_ON_HOLD" | "NOT_CONFIGURED";

export type IntegrationReadiness = {
  key: string;
  name: string;
  state: IntegrationState;
  purpose: string;
  reason: string;
  requirements: string[];
};

export function integrationReadiness(): IntegrationReadiness[] {
  const icdConfigured = Boolean(process.env.ICD11_CLIENT_ID && process.env.ICD11_CLIENT_SECRET);
  return [
    {
      key: "sha",
      name: "SHA claims",
      state: "PREPARED_ON_HOLD",
      purpose: "Eligibility, preauthorisation and authenticated claim exchange",
      reason: "Local claim validation is active; transmission remains disabled until certification, production credentials and an approved endpoint are available.",
      requirements: ["SHA/DHA certification", "Production FHIR endpoint", "Facility and OAuth credentials", "End-to-end conformance testing"],
    },
    {
      key: "icd11",
      name: "WHO ICD-11",
      state: icdConfigured ? "AVAILABLE" : "NOT_CONFIGURED",
      purpose: "Search and record standard diagnosis codes",
      reason: icdConfigured ? "WHO API credentials are configured; the local curated fallback remains available." : "The curated local diagnosis list is active while WHO API credentials are pending.",
      requirements: icdConfigured ? [] : ["WHO ICD API client ID", "WHO ICD API client secret"],
    },
    {
      key: "khis",
      name: "MOH/KHIS reporting",
      state: "PREPARED_ON_HOLD",
      purpose: "Monthly statutory reporting",
      reason: "The system produces a reviewable monthly source summary; direct submission is intentionally disabled pending official mapping and approval.",
      requirements: ["Approved MOH dataset mapping", "KHIS access and credentials", "Facility reporting validation"],
    },
    {
      key: "messaging",
      name: "Patient messaging",
      state: "PREPARED_ON_HOLD",
      purpose: "Appointment reminders and patient notifications",
      reason: "Staff can prepare and copy privacy-safe reminders; automatic sending awaits an approved provider and consent workflow verification.",
      requirements: ["Approved SMS/WhatsApp provider", "Sender identity", "Delivery callbacks", "Consent and opt-out validation"],
    },
    {
      key: "analyser",
      name: "Laboratory analyser",
      state: "PREPARED_ON_HOLD",
      purpose: "Receive verified results from laboratory equipment",
      reason: "Manual verified result entry remains active. Device transmission is held until interface validation and instrument acceptance testing.",
      requirements: ["Instrument protocol/interface specification", "Validated code mapping", "Acceptance and quality-control testing"],
    },
  ];
}
