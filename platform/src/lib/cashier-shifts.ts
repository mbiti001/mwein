export function cashierShiftTotals(openingFloat: unknown, payments: { amount: unknown; status: string; method: string }[], countedCash?: number) {
  const receipts = payments.filter(item => item.status === "CONFIRMED" && item.method === "CASH").reduce((sum, item) => sum + Number(item.amount), 0);
  const expectedCash = Number(openingFloat) + receipts;
  return { receipts, expectedCash, variance: countedCash === undefined ? null : countedCash - expectedCash };
}
