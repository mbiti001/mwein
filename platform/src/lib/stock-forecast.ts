export type StockForecastInput = { code: string; name: string; available: number; reorderLevel: number; consumed: number; expiringWithin30: number };

export function usableBatchStock(batches: { quantityAvailable: unknown; expiryDate: Date | string }[], now = new Date()) {
  const asOf = now.getTime();
  const thirtyDays = asOf + 30 * 86400000;
  const ninetyDays = asOf + 90 * 86400000;
  let available = 0, expiringWithin30 = 0, expiringWithin90 = 0;
  for (const batch of batches) {
    const expiry = new Date(batch.expiryDate).getTime();
    const quantity = Number(batch.quantityAvailable);
    // Match dispensing's expiry > now rule. Invalid, depleted and expired
    // batches must never increase usable stock or upcoming expiry totals.
    if (!Number.isFinite(expiry) || expiry <= asOf || !Number.isFinite(quantity) || quantity <= 0) continue;
    available += quantity;
    if (expiry <= thirtyDays) expiringWithin30 += quantity;
    if (expiry <= ninetyDays) expiringWithin90 += quantity;
  }
  return { available, expiringWithin30, expiringWithin90 };
}

export function stockForecast(input: StockForecastInput, lookbackDays = 90, leadTimeDays = 30) {
  const dailyUse = input.consumed / Math.max(1, lookbackDays);
  const daysOfStock = dailyUse > 0 ? Math.floor(input.available / dailyUse) : null;
  const suggestedOrder = Math.max(0, Math.ceil(dailyUse * leadTimeDays + input.reorderLevel - input.available));
  const status = input.available <= 0 ? "STOCK_OUT" : dailyUse === 0 ? "SLOW_MOVING" : daysOfStock! <= 14 ? "CRITICAL" : daysOfStock! <= 30 ? "LOW" : "HEALTHY";
  return { ...input, dailyUse, daysOfStock, suggestedOrder, status };
}
