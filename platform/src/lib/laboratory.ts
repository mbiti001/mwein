const FBC_ALIASES = new Set(["FBC", "CBC", "FULL BLOOD COUNT", "COMPLETE BLOOD COUNT", "HEMOGRAM", "HAEMOGRAM", "FULL HEMOGRAM", "FULL HAEMOGRAM"]);

export const ZYBIO_Z3_PROFILE = {
  code: "MMS-Z3-FBC-ADULT-v1.0",
  analyser: "Zybio Z3",
  method: "WBC, RBC and platelet counts by electrical impedance; haemoglobin by colorimetry; three-part WBC classification by cell-volume distribution. Red-cell and platelet indices are analyser-calculated.",
  source: "Zybio Z3 Operation Manual and Mwein Medical Services provisional adult reference interval set.",
  footer: "Analysis performed on the Zybio Z3 three-part automated haematology analyser. WBC, RBC and platelets are measured by electrical impedance; haemoglobin by colorimetry. MID cells comprise monocytes, eosinophils and basophils. Reference intervals vary with age, sex and clinical state.",
} as const;

export const ZYBIO_Z3_COMPONENTS = [
  ["White blood cell count", "FBC-WBC", "×10⁹/L"],
  ["Absolute lymphocyte count", "FBC-LYM-ABS", "×10⁹/L"],
  ["Absolute MID-cell count", "FBC-MID-ABS", "×10⁹/L"],
  ["Absolute granulocyte count", "FBC-GRAN-ABS", "×10⁹/L"],
  ["Lymphocytes", "FBC-LYM-PCT", "%"],
  ["MID cells", "FBC-MID-PCT", "%"],
  ["Granulocytes", "FBC-GRAN-PCT", "%"],
  ["Red blood cell count", "FBC-RBC", "×10¹²/L"],
  ["Haemoglobin", "FBC-HGB", "g/dL"],
  ["Haematocrit", "FBC-HCT", "%"],
  ["Mean cell volume", "FBC-MCV", "fL"],
  ["Mean cell haemoglobin", "FBC-MCH", "pg"],
  ["Mean cell haemoglobin concentration", "FBC-MCHC", "g/dL"],
  ["Red-cell distribution width–CV", "FBC-RDW-CV", "%"],
  ["Red-cell distribution width–SD", "FBC-RDW-SD", "fL"],
  ["Platelet count", "FBC-PLT", "×10⁹/L"],
  ["Mean platelet volume", "FBC-MPV", "fL"],
  ["Platelet distribution width", "FBC-PDW", "fL"],
  ["Plateletcrit", "FBC-PCT", "%"],
  ["Platelet large-cell ratio", "FBC-P-LCR", "%"],
  ["Platelet large-cell count", "FBC-P-LCC", "×10⁹/L"],
] as const;

export function normalizeHaemoglobinUnit(value: number, unit: string) {
  return unit.trim().toLowerCase() === "g/l"
    ? { value: value / 10, unit: "g/dL", originalValue: value, originalUnit: unit }
    : { value, unit, originalValue: value, originalUnit: unit };
}

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
