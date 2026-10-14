export type ExpiryBatch = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  quantityAvailable: unknown;
  catalogItem: { name: string; code: string };
  locationBalances: { quantity: unknown; store: { id: string; name: string } }[];
};

export type ExpiryWindow = "expired" | "30" | "90" | "all";

// Use the same instant-based expiry boundary as dispensing and stock forecasting.
// A selected store always uses its ledger balance, never the facility total.
export function expiryReport(batches: ExpiryBatch[], options: {
  now: Date; window: ExpiryWindow; storeId?: string; query?: string;
}) {
  const now = options.now.getTime();
  const term = options.query?.trim().toLowerCase() || "";
  return batches.flatMap(batch => {
    const quantity = options.storeId
      ? batch.locationBalances.filter(balance => balance.store.id === options.storeId)
        .reduce((sum, balance) => sum + Number(balance.quantity), 0)
      : Number(batch.quantityAvailable);
    if (!Number.isFinite(quantity) || quantity <= 0) return [];
    const expiry = new Date(batch.expiryDate).getTime();
    const validExpiry = Number.isFinite(expiry);
    const expired = validExpiry && expiry <= now;
    if (options.window === "expired" && !expired) return [];
    if (["30", "90"].includes(options.window) &&
      (!validExpiry || expired || expiry > now + Number(options.window) * 86400000)) return [];
    if (!`${batch.catalogItem.name} ${batch.catalogItem.code} ${batch.batchNumber}`.toLowerCase().includes(term)) return [];
    return [{ ...batch, quantity, expired, validExpiry,
      daysRemaining: validExpiry ? Math.ceil((expiry - now) / 86400000) : null }];
  }).sort((a, b) => {
    // Missing dates need investigation and must remain visible in the all-stock view.
    if (!a.validExpiry) return b.validExpiry ? -1 : a.id.localeCompare(b.id);
    if (!b.validExpiry) return 1;
    return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime() || a.id.localeCompare(b.id);
  });
}
