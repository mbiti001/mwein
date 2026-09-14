export type DuplicateCandidate = { id: string; normalizedName: string; dateOfBirth: Date | string | null; contacts: { value: string }[] };

export function duplicatePatientGroups(patients: DuplicateCandidate[]) {
  const groups = new Map<string, DuplicateCandidate[]>();
  for (const patient of patients) {
    const birth = patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().slice(0, 10) : "unknown";
    const contact = patient.contacts[0]?.value.replace(/\D/g, "") || "none";
    const key = contact !== "none" ? `contact:${contact}` : `name:${patient.normalizedName}|birth:${birth}`;
    groups.set(key, [...(groups.get(key) || []), patient]);
  }
  return [...groups.entries()].filter(([, members]) => members.length > 1).map(([key, members]) => ({ key, patientIds: members.map(item => item.id) }));
}
