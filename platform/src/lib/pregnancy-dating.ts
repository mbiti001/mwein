const DAY_MS = 86_400_000;
const TERM_DAYS = 280;

export type PregnancyDating = {
  lnmp: string;
  estimatedDeliveryDate: string;
  gestationalAgeWeeks: number;
  gestationalAgeDays: number;
  gestationalAgeTotalDays: number;
  method: "LNMP";
};

function isoDateMilliseconds(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const milliseconds = Date.UTC(year, month - 1, day);
  const parsed = new Date(milliseconds);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return milliseconds;
}

function dateToIso(milliseconds: number) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export function dateInTimeZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function pregnancyDatingFromLnmp(lnmp: string, asOf: Date | string = new Date()): PregnancyDating | null {
  const lnmpMilliseconds = isoDateMilliseconds(lnmp);
  const asOfMilliseconds = typeof asOf === "string"
    ? isoDateMilliseconds(asOf)
    : Number.isFinite(asOf.getTime())
      ? Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())
      : null;
  if (lnmpMilliseconds === null || asOfMilliseconds === null) return null;
  const totalDays = Math.floor((asOfMilliseconds - lnmpMilliseconds) / DAY_MS);
  if (totalDays < 0) return null;
  return {
    lnmp,
    estimatedDeliveryDate: dateToIso(lnmpMilliseconds + TERM_DAYS * DAY_MS),
    gestationalAgeWeeks: Math.floor(totalDays / 7),
    gestationalAgeDays: totalDays % 7,
    gestationalAgeTotalDays: totalDays,
    method: "LNMP",
  };
}

export function gestationalAgeLabel(dating: Pick<PregnancyDating, "gestationalAgeWeeks" | "gestationalAgeDays">) {
  return `${dating.gestationalAgeWeeks} weeks ${dating.gestationalAgeDays} days`;
}

export function applyLnmpDating(
  data: Record<string, string | boolean>,
  asOf: Date | string = new Date(),
) {
  const lnmp = typeof data.lmp === "string" ? data.lmp : "";
  const dating = pregnancyDatingFromLnmp(lnmp, asOf);
  if (!dating) return { data, dating: null };
  return {
    data: {
      ...data,
      edd: dating.estimatedDeliveryDate,
      gestationWeeks: String(dating.gestationalAgeWeeks),
      gestationDays: String(dating.gestationalAgeDays),
      datingMethod: "LNMP",
    },
    dating,
  };
}
