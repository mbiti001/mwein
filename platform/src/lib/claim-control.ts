export type ClaimControlInput = {
  id: string;
  claimNumber: string;
  patientName: string;
  patientNumber: string;
  fundCode?: string | null;
  amount: unknown;
  status: string;
  serviceDate?: Date | string | null;
  submissionDeadline?: Date | string | null;
  submittedAt?: Date | string | null;
  updatedAt: Date | string;
};

const DAY = 86_400_000;

export function addWorkingDays(value: Date | string, days: number) {
  const date = new Date(value);
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

export function claimActionDeadline(claim: ClaimControlInput) {
  if (claim.status === "DRAFT") return claim.submissionDeadline ? new Date(claim.submissionDeadline) : null;
  if (claim.status === "RETURNED") return new Date(new Date(claim.updatedAt).getTime() + 14 * DAY);
  if (["REJECTED", "REDUCED"].includes(claim.status)) return addWorkingDays(claim.updatedAt, 7);
  if (claim.status === "SUBMITTED" && claim.submittedAt) return new Date(new Date(claim.submittedAt).getTime() + 90 * DAY);
  return null;
}

export function claimControlSummary(claims: ClaimControlInput[], now = new Date()) {
  const open = claims.filter(claim => !["PAID", "RECOVERED", "CANCELLED"].includes(claim.status));
  const alerts = open.flatMap(claim => {
    const deadline = claimActionDeadline(claim);
    if (!deadline) return [];
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / DAY);
    const urgent = daysRemaining <= 2;
    if (!urgent && claim.status !== "SUBMITTED") return [];
    return [{ ...claim, deadline, daysRemaining, severity: deadline.getTime() < now.getTime() ? "OVERDUE" : urgent ? "URGENT" : "WATCH" }];
  }).sort((left, right) => left.deadline.getTime() - right.deadline.getTime());
  return {
    total: claims.length,
    open: open.length,
    draft: claims.filter(claim => claim.status === "DRAFT").length,
    corrections: claims.filter(claim => claim.status === "RETURNED").length,
    reviews: claims.filter(claim => ["REJECTED", "REDUCED", "UNDER_REVIEW"].includes(claim.status)).length,
    unpaid: claims.filter(claim => ["SUBMITTED", "APPROVED", "WITHHELD"].includes(claim.status)).reduce((sum, claim) => sum + Number(claim.amount), 0),
    alerts,
  };
}
