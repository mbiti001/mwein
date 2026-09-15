export type ReportVisit = {
  priority: string;
  status: string;
  invoice?: {
    items: { quantity: unknown; unitPrice: unknown }[];
    payments: { amount: unknown; status: string }[];
    claims: {
      id: string;
      claimNumber: string;
      payer: string;
      amount: unknown;
      status: string;
      updatedAt: Date | string;
    }[];
  } | null;
};

export function isIsoCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function summarizeOperations(visits: ReportVisit[], now = new Date()) {
  let billed = 0;
  let received = 0;
  const claimExceptions: Array<{
    id: string;
    claimNumber: string;
    payer: string;
    amount: number;
    status: string;
    reason: string;
  }> = [];

  const staleSubmittedAt = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  for (const visit of visits) {
    if (!visit.invoice) continue;
    billed += visit.invoice.items.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
      0,
    );
    received += visit.invoice.payments
      .filter((payment) => payment.status === "CONFIRMED")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);

    for (const claim of visit.invoice.claims) {
      const stale =
        claim.status === "SUBMITTED" &&
        new Date(claim.updatedAt).getTime() < staleSubmittedAt;
      if (["RETURNED", "REJECTED", "REDUCED", "WITHHELD"].includes(claim.status) || stale) {
        claimExceptions.push({
          id: claim.id,
          claimNumber: claim.claimNumber,
          payer: claim.payer,
          amount: Number(claim.amount),
          status: claim.status,
          reason: stale ? "Submitted over 7 days ago" : claim.status.charAt(0) + claim.status.slice(1).toLowerCase(),
        });
      }
    }
  }

  return {
    visits: visits.length,
    completedVisits: visits.filter((visit) => visit.status === "COMPLETED").length,
    emergencyVisits: visits.filter((visit) => visit.priority === "EMERGENCY").length,
    billed,
    received,
    outstanding: Math.max(0, billed - received),
    claimExceptions,
  };
}

export function summarizeQueuePerformance(entries: { servicePoint: string; status: string; enteredAt: Date | string; completedAt: Date | string | null }[]) {
  const grouped = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.servicePoint, (counts.get(entry.servicePoint) || 0) + 1);
    if (!entry.completedAt) continue;
    const minutes = Math.max(0, Math.round((new Date(entry.completedAt).getTime() - new Date(entry.enteredAt).getTime()) / 60000));
    grouped.set(entry.servicePoint, [...(grouped.get(entry.servicePoint) || []), minutes]);
  }
  return [...counts.entries()].map(([servicePoint, count]) => {
    const durations = [...(grouped.get(servicePoint) || [])].sort((a, b) => a - b);
    return {
      servicePoint, count, completed: durations.length,
      averageMinutes: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      p90Minutes: durations.length ? durations[Math.max(0, Math.ceil(durations.length * 0.9) - 1)] : 0,
    };
  }).sort((left, right) => right.p90Minutes - left.p90Minutes || left.servicePoint.localeCompare(right.servicePoint));
}

export function summarizeReferralFlow(referrals: { status: string }[]) {
  const counted = (statuses: string[]) => referrals.filter(item => statuses.includes(item.status)).length;
  const sent = counted(["SENT", "ACCEPTED", "ATTENDED", "RETURNED", "CLOSED"]);
  const closedLoop = counted(["RETURNED", "CLOSED"]);
  return { created: referrals.length, sent, attended: counted(["ATTENDED", "RETURNED", "CLOSED"]), closedLoop, closureRate: sent ? Math.round(closedLoop / sent * 100) : 0 };
}

export function summarizeCashierActivity(payments: { amount: unknown; status: string; method: string; receivedBy: { displayName: string } | null }[]) {
  const grouped = new Map<string, { cashier: string; confirmed: number; reversed: number; transactions: number; methods: Record<string, number> }>();
  for (const payment of payments) {
    const cashier = payment.receivedBy?.displayName || "Legacy / unassigned";
    const row = grouped.get(cashier) || { cashier, confirmed: 0, reversed: 0, transactions: 0, methods: {} };
    const amount = Number(payment.amount);
    row.transactions += 1;
    if (payment.status === "CONFIRMED") { row.confirmed += amount; row.methods[payment.method] = (row.methods[payment.method] || 0) + amount; }
    if (["REVERSED", "REFUNDED"].includes(payment.status)) row.reversed += amount;
    grouped.set(cashier, row);
  }
  return [...grouped.values()].sort((left, right) => right.confirmed - left.confirmed);
}

export function summarizeDispensing(dispensations: { quantity: unknown; catalogItem: { code: string; name: string } | null; items: { quantity: unknown; unitPrice: unknown; unitCost: unknown }[] }[]) {
  const grouped = new Map<string, { code: string; name: string; quantity: number; revenue: number; cost: number }>();
  for (const dispensation of dispensations) {
    const code = dispensation.catalogItem?.code || "UNMAPPED";
    const row = grouped.get(code) || { code, name: dispensation.catalogItem?.name || "Unmapped medicine", quantity: 0, revenue: 0, cost: 0 };
    row.quantity += Number(dispensation.quantity);
    for (const item of dispensation.items) {
      row.revenue += Number(item.quantity) * Number(item.unitPrice);
      row.cost += Number(item.quantity) * Number(item.unitCost || 0);
    }
    grouped.set(code, row);
  }
  return [...grouped.values()].sort((left, right) => right.quantity - left.quantity);
}
