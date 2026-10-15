import { recordedText } from "@/lib/summary-findings";

export type RecordField = {
  label: string;
  value: unknown;
  wide?: boolean;
  omitUnassessed?: boolean;
};

// Absence is different from an explicitly recorded negative or zero.
export function recordValue(value: unknown, omitUnassessed = false): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  return (omitUnassessed ? recordedText(value) : value.trim()) || null;
}

export function RecordFields({ fields, title, className = "" }: {
  fields: RecordField[];
  title?: string;
  className?: string;
}) {
  const visible = fields.map(field => ({ ...field, text: recordValue(field.value, field.omitUnassessed) })).filter(field => field.text !== null);
  if (!visible.length) return null;
  return <section className={`recordGroup ${className}`}>
    {title && <h2>{title}</h2>}
    <dl className="recordFields">{visible.map((field, index) => <div key={`${field.label}-${index}`} className={field.wide ? "recordFieldWide" : undefined}>
      <dt>{field.label}</dt><dd>{field.text}</dd>
    </div>)}</dl>
  </section>;
}
