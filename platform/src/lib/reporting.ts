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
      if (claim.status === "REJECTED" || stale) {
        claimExceptions.push({
          id: claim.id,
          claimNumber: claim.claimNumber,
          payer: claim.payer,
          amount: Number(claim.amount),
          status: claim.status,
          reason: claim.status === "REJECTED" ? "Rejected" : "Submitted over 7 days ago",
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
