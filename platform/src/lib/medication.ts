export function normalizeMedicationConcept(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function sameVisitMedicationKey(visitId: string, medicationConceptId: string) {
  return `${visitId}:${medicationConceptId}`;
}

export function calculateDispenseQuantity(doseQuantity: number, frequencyPerDay: number, durationDays: number) {
  if (![doseQuantity, frequencyPerDay, durationDays].every(Number.isFinite) || doseQuantity <= 0 || frequencyPerDay <= 0 || durationDays <= 0) return 0;
  return Number((doseQuantity * frequencyPerDay * durationDays).toFixed(3));
}

export function treatmentStopDate(start: Date, duration?: string, explicitStop?: Date) {
  if (explicitStop) return explicitStop;
  const match = duration?.trim().match(/^(\d+)\s*(day|days|week|weeks|month|months)$/i);
  if (!match) return null;
  const stop = new Date(start);
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("day")) stop.setUTCDate(stop.getUTCDate() + amount - 1);
  if (unit.startsWith("week")) stop.setUTCDate(stop.getUTCDate() + amount * 7 - 1);
  if (unit.startsWith("month")) stop.setUTCMonth(stop.getUTCMonth() + amount);
  return stop;
}

export function periodsOverlap(startA: Date, stopA: Date | null, startB: Date, stopB: Date | null) {
  const endA = stopA?.getTime() ?? Number.POSITIVE_INFINITY;
  const endB = stopB?.getTime() ?? Number.POSITIVE_INFINITY;
  return startA.getTime() <= endB && startB.getTime() <= endA;
}

export function prescriptionSnapshot(value: {
  medicationConceptId?: string | null; genericName?: string | null; strength?: string | null;
  dosageForm?: string | null; dose: string; route: string; frequency: string; duration?: string | null;
  startDate: Date; stopDate?: Date | null; quantity: number | string; instructions: string;
}) {
  return {
    medicationConceptId: value.medicationConceptId || null,
    genericName: value.genericName || null,
    strength: value.strength || null,
    dosageForm: value.dosageForm || null,
    dose: value.dose,
    route: value.route,
    frequency: value.frequency,
    duration: value.duration || null,
    startDate: value.startDate.toISOString(),
    stopDate: value.stopDate?.toISOString() || null,
    quantity: Number(value.quantity),
    instructions: value.instructions,
  };
}
