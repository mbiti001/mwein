export type MoneyLine = { quantity: unknown; unitPrice: unknown };
export type MoneyPayment = { amount: unknown };

export const claimTransitions = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PAID", "REJECTED", "CANCELLED"],
  REJECTED: ["SUBMITTED", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
} as const;

export type ClaimStatus = keyof typeof claimTransitions;

export function allowedClaimStatuses(status: ClaimStatus): readonly ClaimStatus[] {
  return claimTransitions[status];
}

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus) {
  return allowedClaimStatuses(from).some((status) => status === to);
}

export function invoiceTotals(items: MoneyLine[], payments: MoneyPayment[]) {
  const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  return { total, paid, balance: Math.max(0, total - paid) };
}

export function paymentFitsBalance(amount: number, balance: number) {
  return Number.isFinite(amount) && amount > 0 && amount <= balance + 0.001;
}
