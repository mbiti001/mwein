/** Revision of the saved encounter, never an authorization credential. */
export function consultationRevision(encounter?: { id?: string; updatedAt?: Date | string } | null): string | null {
  if (!encounter?.id || !encounter.updatedAt) return null;
  return `${encounter.id}:${new Date(encounter.updatedAt).toISOString()}`;
}

export function consultationConflict() {
  return Object.assign(new Error("The saved consultation has changed. Your text is still here. Review the latest saved notes before continuing."), {
    status: 409, details: { code: "CONSULTATION_REVISION_CONFLICT" },
  });
}

export function nextEncounterTime(previous?: Date): Date {
  return new Date(Math.max(Date.now(), previous ? previous.getTime() + 1 : 0));
}
