type CompletionVisit = {
  status: string;
  encounters: { status: string }[];
  orders: { status: string; displayName?: string }[];
  invoice: null | {
    status: string;
    items: { quantity: unknown; unitPrice: unknown }[];
    payments: { status: string; amount: unknown }[];
    claims: { status: string; amount: unknown }[];
  };
};

export function visitCompletionBlockers(visit: CompletionVisit) {
  const blockers: string[] = [];
  if (["COMPLETED", "CANCELLED", "ADMITTED"].includes(visit.status)) blockers.push(`Visit is already ${visit.status.toLowerCase()}`);
  if (!visit.encounters.some(item => item.status === "SIGNED")) blockers.push("Clinical consultation is not signed");
  const openOrders = visit.orders.filter(item => ["DRAFT", "REQUESTED", "IN_PROGRESS"].includes(item.status));
  if (openOrders.length) blockers.push(`Resolve ${openOrders.length} open order${openOrders.length === 1 ? "" : "s"}: ${openOrders.slice(0, 3).map(item => item.displayName || "unnamed order").join(", ")}`);
  if (!visit.invoice) blockers.push("Visit has no invoice");
  if (visit.invoice) {
    const total = visit.invoice.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
    const paid = visit.invoice.payments.filter(item => item.status === "CONFIRMED").reduce((sum, item) => sum + Number(item.amount), 0);
    const covered = visit.invoice.claims.filter(item => ["SUBMITTED", "RETURNED", "APPROVED", "REDUCED", "UNDER_REVIEW", "WITHHELD", "PAID"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0);
    const balance = Math.max(0, total - paid - covered);
    if (balance > 0.001) blockers.push(`Invoice has an uncovered balance of ${balance.toFixed(2)}`);
  }
  return blockers;
}
