/** Keep deliberate clearing separate from invalid or absent numeric input. */
export function demographicCorrectionValue(field: string, raw: string): string | number | null {
  if (raw === "NULL") return null;
  if (field !== "estimatedAgeYears") return raw;
  const value = raw.trim() ? Number(raw) : NaN;
  // Preserve the existing correction API range; registration has its own range.
  if (!Number.isInteger(value) || value < 0 || value > 130)
    throw new Error("Enter an estimated age in whole years from 0 to 130, or type NULL to deliberately clear it.");
  return value;
}
