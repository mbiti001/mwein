const FBC_ALIASES = new Set(["FBC", "CBC", "FULL BLOOD COUNT", "COMPLETE BLOOD COUNT", "HEMOGRAM", "HAEMOGRAM", "FULL HEMOGRAM", "FULL HAEMOGRAM"]);

export function canonicalLaboratoryCode(value: string) {
  const normalized = value.trim().replace(/[\s_-]+/g, " ").toUpperCase();
  return FBC_ALIASES.has(normalized) ? "FBC" : value.trim().toUpperCase();
}

export function laboratoryDisplayName(code: string, fallback?: string) {
  return canonicalLaboratoryCode(code) === "FBC"
    ? "Full blood count (FBC) / Full haemogram (hemogram)"
    : fallback || code;
}

export function laboratoryFlagSummary(items: { analyte: string; flag?: string | null }[]) {
  const abnormal = items.filter(item => item.flag && !["NORMAL", "N"].includes(item.flag));
  if (!abnormal.length) return "No analytes are flagged outside the applicable reference intervals.";
  const critical = abnormal.some(item => ["CRITICAL", "LL", "HH"].includes(item.flag!));
  const details = abnormal.map(item => `${item.analyte} ${item.flag!.toLowerCase()}`).join("; ");
  return `${critical ? "Critical result flag present. " : ""}Flag summary: ${details}. Correlate with the clinical context and review the blood film or repeat testing where indicated.`;
}
