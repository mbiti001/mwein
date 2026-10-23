import { careServiceProfile } from "@/lib/care-service-points";
import { RecordFields, recordValue } from "./RecordFields";

export type AssessmentSnapshot = {
  servicePoint: string;
  templateVersion: string;
  data: Record<string, unknown>;
  riskLevel?: string | null;
  followUpAt?: string | null;
};

function savedValue(value: unknown) {
  return recordValue(value) ?? (value !== null && typeof value === "object" ? JSON.stringify(value) : "Not recorded");
}

// Only apply labels/units from the exact saved template. Preserve extra keys and
// unfamiliar templates so a later template cannot silently hide old values.
export function AssessmentSnapshotFields({ snapshot }: { snapshot: AssessmentSnapshot }) {
  const profile = careServiceProfile(snapshot.servicePoint);
  const matched = profile?.templateVersion === snapshot.templateVersion ? profile : undefined;
  const knownKeys = new Set(matched?.sections.flatMap(section => section.fields.map(field => field.key)) || []);
  const extra = Object.entries(snapshot.data).filter(([key]) => !knownKeys.has(key));
  return <>
    {!matched && <p>Saved template labels are unavailable. Values below use their original field keys.</p>}
    {matched?.sections.map(section => <RecordFields key={section.title} title={section.title} fields={section.fields.map(field => {
      const value = recordValue(snapshot.data[field.key]);
      return { label: field.label, value: value === null ? savedValue(snapshot.data[field.key]) : `${value}${field.unit ? ` ${field.unit}` : ""}`, wide: field.type === "textarea" };
    })} />)}
    {extra.length > 0 && <RecordFields title={matched ? "Additional saved fields" : "Saved fields"} fields={extra.map(([key, value]) => ({ label: key, value: savedValue(value), wide: true }))} />}
    <RecordFields fields={[{ label: "Clinical risk", value: snapshot.riskLevel || "Not recorded" }, { label: "Next follow-up", value: snapshot.followUpAt?.slice(0, 10) || "Not recorded" }]} />
  </>;
}
