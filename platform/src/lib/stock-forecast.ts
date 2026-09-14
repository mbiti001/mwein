export type StockForecastInput = { code: string; name: string; available: number; reorderLevel: number; consumed: number; expiringWithin30: number };

export function stockForecast(input: StockForecastInput, lookbackDays = 90, leadTimeDays = 30) {
  const dailyUse = input.consumed / Math.max(1, lookbackDays);
  const daysOfStock = dailyUse > 0 ? Math.floor(input.available / dailyUse) : null;
  const suggestedOrder = Math.max(0, Math.ceil(dailyUse * leadTimeDays + input.reorderLevel - input.available));
  const status = input.available <= 0 ? "STOCK_OUT" : dailyUse === 0 ? "SLOW_MOVING" : daysOfStock! <= 14 ? "CRITICAL" : daysOfStock! <= 30 ? "LOW" : "HEALTHY";
  return { ...input, dailyUse, daysOfStock, suggestedOrder, status };
}
