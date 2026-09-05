export function canTransitionPurchaseOrder(status: string, next: string) {
  return ({ DRAFT: ["SUBMITTED", "CANCELLED"], SUBMITTED: ["APPROVED", "CANCELLED"], APPROVED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"], PARTIALLY_RECEIVED: ["PARTIALLY_RECEIVED", "RECEIVED"] }[status] || []).includes(next);
}

export function isIndependentChecker(checkerId: string, ...makerIds: (string | null | undefined)[]) {
  return makerIds.every(id => !id || id !== checkerId);
}

export function countDisposition(variance: number) {
  return variance === 0 ? "POSTED" : "PENDING";
}
