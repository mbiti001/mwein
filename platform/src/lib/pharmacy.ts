export function dispensingBalance(
  prescribedQuantity: number,
  previouslyDispensedQuantity: number,
  quantityNow: number,
) {
  if (![prescribedQuantity, previouslyDispensedQuantity, quantityNow].every(Number.isFinite))
    throw new Error("Dispensing quantities must be valid numbers");
  if (prescribedQuantity <= 0 || previouslyDispensedQuantity < 0 || quantityNow <= 0)
    throw new Error("Dispensing quantities are outside the allowed range");

  const remainingBefore = Math.max(0, prescribedQuantity - previouslyDispensedQuantity);
  if (quantityNow > remainingBefore + 0.000001)
    throw new Error(`Dispensed quantity cannot exceed the outstanding quantity of ${remainingBefore}`);

  const cumulativeDispensed = previouslyDispensedQuantity + quantityNow;
  const remainingAfter = Math.max(0, prescribedQuantity - cumulativeDispensed);
  return {
    cumulativeDispensed,
    remainingAfter,
    complete: remainingAfter <= 0.000001,
  };
}

export type FefoBatch = {
  id: string;
  batchNumber: string;
  expiryDate: Date | string;
  quantityAvailable: number;
};

export type MedicationIdentity = {
  medicationConceptId?: string | null;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
};

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") || "";
}

export function isEquivalentMedication(
  prescribed: MedicationIdentity,
  candidate: MedicationIdentity,
) {
  const prescribedConcept = normalized(prescribed.medicationConceptId);
  const candidateConcept = normalized(candidate.medicationConceptId);
  const prescribedGeneric = normalized(prescribed.genericName);
  const candidateGeneric = normalized(candidate.genericName);
  const sameIngredient = prescribedConcept && candidateConcept
    ? prescribedConcept === candidateConcept
    : Boolean(prescribedGeneric && prescribedGeneric === candidateGeneric);

  return Boolean(
    sameIngredient &&
      normalized(prescribed.strength) === normalized(candidate.strength) &&
      normalized(prescribed.dosageForm) === normalized(candidate.dosageForm),
  );
}

export function planFefoAllocation(batches: FefoBatch[], quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("Dispensed quantity must be a valid positive number");

  let needed = quantity;
  const allocations = [] as Array<FefoBatch & { quantity: number }>;
  for (const batch of batches) {
    if (needed <= 0) break;
    const used = Math.min(needed, batch.quantityAvailable);
    if (used > 0) allocations.push({ ...batch, quantity: used });
    needed -= used;
  }
  if (needed > 0.000001)
    throw new Error(`Insufficient unexpired stock. Available: ${quantity - needed}`);
  return allocations;
}

function sameAllocation(
  left: Array<FefoBatch & { quantity: number }>,
  right: Array<FefoBatch & { quantity: number }>,
) {
  return left.length === right.length && left.every((item, index) =>
    item.id === right[index]?.id && Math.abs(item.quantity - right[index].quantity) <= 0.000001,
  );
}

export function planDispensingAllocation(
  batches: FefoBatch[],
  quantity: number,
  preferredBatchId?: string,
) {
  const standardAllocation = planFefoAllocation(batches, quantity);
  if (!preferredBatchId)
    return { allocation: standardAllocation, standardAllocation, fefoOverridden: false };

  const preferred = batches.find((batch) => batch.id === preferredBatchId);
  if (!preferred) throw new Error("Selected stock batch is not available for dispensing");
  const allocation = planFefoAllocation(
    [preferred, ...batches.filter((batch) => batch.id !== preferredBatchId)],
    quantity,
  );
  return {
    allocation,
    standardAllocation,
    fefoOverridden: !sameAllocation(allocation, standardAllocation),
  };
}
