// A complete assignable role: staff assignment replaces, rather than adds, roles.
export const clinicianCoverRole = {
  code: "CLINICIAN_COVER",
  name: "Clinician — shortage cover",
  grants: ["patient.read", "patient.create", "visit.read", "visit.create", "triage.write", "encounter.write", "clinical.history.read", "clinical.results.read", "clinical.summary.read", "referral.read", "order.write", "billing.read", "billing.write"],
};
