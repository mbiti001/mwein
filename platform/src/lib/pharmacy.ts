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
