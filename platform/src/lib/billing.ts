export type MoneyLine = { quantity: unknown; unitPrice: unknown };
export type MoneyPayment = { amount: unknown };

export const claimTransitions = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["RETURNED", "APPROVED", "REDUCED", "REJECTED", "WITHHELD", "CANCELLED"],
  RETURNED: ["SUBMITTED", "CANCELLED"],
  APPROVED: ["PAID", "WITHHELD", "REJECTED", "CANCELLED"],
  REDUCED: ["UNDER_REVIEW", "PAID", "CANCELLED"],
  REJECTED: ["UNDER_REVIEW", "CANCELLED"],
  UNDER_REVIEW: ["SUBMITTED", "APPROVED", "REDUCED", "REJECTED", "CANCELLED"],
  WITHHELD: ["APPROVED", "PAID", "REJECTED", "CANCELLED"],
  PAID: ["RECOVERED"],
  RECOVERED: [],
  CANCELLED: [],
} as const;

export const balanceReservingClaimStatuses: ClaimStatus[] = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "REDUCED", "UNDER_REVIEW", "WITHHELD", "PAID"];

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

export function patientPayBalance(total: number, paid: number, claims: { amount: unknown; status: string }[]) {
  const reserved = claims.filter(claim => balanceReservingClaimStatuses.includes(claim.status as ClaimStatus)).reduce((sum, claim) => sum + Number(claim.amount), 0);
  return Math.max(0, total - paid - reserved);
}
