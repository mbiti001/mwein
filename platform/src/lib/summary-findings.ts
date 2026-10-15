export type SummaryFinding = { label: string; value: string };
export type RecordedFindings = { findings: SummaryFinding[]; notes: SummaryFinding[] };

const unrecorded = new Set([
  "not assessed", "not examined", "not recorded", "not auscultated",
  "not asked", "not applicable", "not applicable / not asked",
]);

export function recordedText(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return unrecorded.has(text.toLowerCase().replace(/\s+/g, " ")) ? "" : text;
}

// Render the stored note without rewriting it. Match only whole placeholder
// values: negatives ("Absent", "None", "Not elevated") are actual findings.
export function recordedFindings(value: unknown): RecordedFindings {
  const result: RecordedFindings = { findings: [], notes: [] };
  if (typeof value !== "string") return result;
  const lines = value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon > 0) {
      const label = line.slice(0, colon).trim();
      // The form appends free-text notes last. Preserve their line breaks and
      // any colon-delimited text, rather than interpreting it as more fields.
      if (label.toLowerCase() === "additional findings") {
        const note = recordedText([line.slice(colon + 1), ...lines.slice(index + 1)].join("\n"));
        if (note) result.notes.push({ label: "Additional findings", value: note });
        break;
      }
      const finding = recordedText(line.slice(colon + 1));
      if (finding) result.findings.push({ label, value: finding });
    } else if (recordedText(line)) {
      result.notes.push({ label: "", value: line });
    }
  }
  return result;
}

export function hasRecordedFindings(value: RecordedFindings): boolean {
  return value.findings.length > 0 || value.notes.length > 0;
}
