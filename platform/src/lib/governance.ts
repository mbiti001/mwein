export const governanceGateDefinitions = [
  { code: "CLINICAL_UAT", name: "Clinical user acceptance", ownerRole: "Medical director", description: "Clinician-led scenario testing, safety sign-off and issue closure." },
  { code: "DPIA_DPA", name: "Privacy and data protection", ownerRole: "Data protection officer", description: "DPIA, processor agreements, retention schedule and data-subject procedures." },
  { code: "PENETRATION_TEST", name: "Independent security test", ownerRole: "Security owner", description: "Independent penetration test with critical and high findings closed." },
  { code: "BACKUP_RESTORE_DRILL", name: "Backup and restore drill", ownerRole: "Operations owner", description: "Encrypted backup, independent restore and measured recovery objectives." },
  { code: "MFA_ENFORCEMENT", name: "Workforce MFA", ownerRole: "Identity owner", description: "Production identity provider enforces MFA for every workforce account." },
  { code: "INCIDENT_RESPONSE", name: "Incident response", ownerRole: "Facility leadership", description: "Named responders, escalation contacts, downtime procedures and rehearsal evidence." },
  { code: "ICD_TERMINOLOGY", name: "Clinical terminology governance", ownerRole: "Medical director", description: "ICD release, mapping policy and terminology update process are approved." },
  { code: "AUDIT_RETENTION", name: "External audit retention", ownerRole: "Compliance owner", description: "Verified audit exports are retained in access-controlled immutable storage." },
  { code: "DHA_INTEGRATIONS", name: "National integration approvals", ownerRole: "Interoperability owner", description: "DHA/SHA/KHIS credentials, certification and production endpoints are approved." },
  { code: "AI_DATA_GOVERNANCE", name: "AI data governance", ownerRole: "Data protection officer", description: "Patient-data scope, OpenAI project retention mode, residency, processor terms and incident handling are approved." },
  { code: "AI_CLINICAL_VALIDATION", name: "AI clinical validation", ownerRole: "Medical director", description: "The GPT-6 Astra summary workflow, grounded-output checks, clinician review, eval results and rollback are approved." },
] as const;

export type GovernanceGateCode = typeof governanceGateDefinitions[number]["code"];

export type GovernanceEvidenceRecord = {
  gateCode: string;
  status: string;
  owner: string;
  evidenceReference: string | null;
  approvedAt: Date | null;
  reviewDueAt: Date | null;
  notes?: string | null;
};

function evidenceReady(record: GovernanceEvidenceRecord | undefined, now: Date) {
  const expired = Boolean(record?.reviewDueAt && record.reviewDueAt <= now);
  const ready = Boolean(record?.status === "APPROVED" && record.approvedAt && record.evidenceReference && !expired);
  return { expired, ready };
}

export function governanceReadiness(evidence: GovernanceEvidenceRecord[], now = new Date()) {
  const byCode = new Map(evidence.map((item) => [item.gateCode, item]));
  const gates = governanceGateDefinitions.map((definition) => {
    const record = byCode.get(definition.code);
    const { expired, ready } = evidenceReady(record, now);
    return { ...definition, evidence: record || null, expired, ready };
  });
  return { ready: gates.every((gate) => gate.ready), gates, approved: gates.filter((gate) => gate.ready).length, total: gates.length };
}

export function aiGovernanceReadiness(evidence: GovernanceEvidenceRecord[], now = new Date()) {
  const byCode = new Map(evidence.map((item) => [item.gateCode, item]));
  const dataGovernance = byCode.get("AI_DATA_GOVERNANCE");
  const clinicalValidation = byCode.get("AI_CLINICAL_VALIDATION");
  const dataReady = evidenceReady(dataGovernance, now).ready;
  const clinicalReady = evidenceReady(clinicalValidation, now).ready;
  return {
    ready: dataReady && clinicalReady,
    missing: [
      ...(!dataReady ? ["AI data-governance approval"] : []),
      ...(!clinicalReady ? ["AI clinical-validation approval"] : []),
    ],
    dataGovernanceReference: dataGovernance?.evidenceReference || null,
    clinicalSafetyReference: clinicalValidation?.evidenceReference || null,
  };
}

export function productionConfigurationReadiness(environment: Record<string, string | undefined> = process.env) {
  const oidcReady = Boolean(environment.OIDC_ISSUER?.startsWith("https://") && environment.OIDC_CLIENT_ID && (environment.OIDC_CLIENT_SECRET?.length || 0) >= 16 && environment.OIDC_REDIRECT_URI?.startsWith("https://"));
  const checks = [
    { code: "AUTH_SECRET", ready: Boolean(environment.AUTH_SECRET && environment.AUTH_SECRET.length >= 32) },
    { code: "APP_ORIGIN", ready: Boolean(environment.APP_ORIGIN && /^https:\/\//.test(environment.APP_ORIGIN)) },
    { code: "EXTERNAL_IDENTITY_PROVIDER", ready: oidcReady },
    { code: "AUDIT_RETENTION_TARGET", ready: Boolean(environment.AUDIT_RETENTION_TARGET) },
    { code: "DATABASE_BACKUP_TARGET", ready: Boolean(environment.DATABASE_BACKUP_TARGET) },
  ];
  return { ready: checks.every((check) => check.ready), checks };
}
