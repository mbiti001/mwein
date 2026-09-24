import { z } from "zod";

export const documentKinds = ["SICK", "MATERNITY", "DELIVERY", "GATE"] as const;
export type DocumentKind = typeof documentKinds[number];
type Field = { key: string; label: string; type?: "date" | "datetime-local" | "textarea"; required?: boolean };
export const documentDefinitions: Record<DocumentKind, { title: string; permission: string; clinical: boolean; fields: Field[] }> = {
  SICK: { title: "Sick sheet", permission: "encounter.write", clinical: true, fields: [
    { key: "assessmentDate", label: "Date assessed", type: "date", required: true }, { key: "restFrom", label: "Rest advised from", type: "date", required: true }, { key: "restTo", label: "Rest advised through", type: "date", required: true }, { key: "reviewDate", label: "Review / return date", type: "date" }, { key: "recommendation", label: "Work or school recommendation (minimum necessary information)", type: "textarea", required: true },
  ] },
  MATERNITY: { title: "Maternity delivery record", permission: "encounter.write", clinical: true, fields: [
    { key: "deliveredAt", label: "Delivery date and time (facility local time)", type: "datetime-local", required: true }, { key: "place", label: "Place of delivery", required: true }, { key: "mode", label: "Mode of delivery", required: true }, { key: "maternalOutcome", label: "Maternal outcome and care record reference", type: "textarea", required: true }, { key: "newbornOutcome", label: "Newborn record reference(s) and outcome", type: "textarea", required: true }, { key: "followUp", label: "Follow-up and handover", type: "textarea", required: true },
  ] },
  DELIVERY: { title: "Delivery note", permission: "inventory.receive", clinical: false, fields: [
    { key: "date", label: "Delivery date", type: "date", required: true }, { key: "supplier", label: "Supplier / dispatching department", required: true }, { key: "recipient", label: "Receiving department", required: true }, { key: "orderReference", label: "Purchase order / requisition reference", required: true }, { key: "items", label: "Items, quantities and condition", type: "textarea", required: true }, { key: "deliveredBy", label: "Delivered by", required: true },
  ] },
  GATE: { title: "Gate pass", permission: "visit.create", clinical: false, fields: [
    { key: "departureAt", label: "Departure date and time (facility local time)", type: "datetime-local", required: true }, { key: "destination", label: "Destination / purpose of movement", required: true }, { key: "property", label: "Items or property authorized (if applicable)", type: "textarea" }, { key: "instructions", label: "Movement instructions", type: "textarea", required: true },
  ] },
};
export const documentKindSchema = z.enum(documentKinds);
export function parseDocumentPayload(kind: DocumentKind, input: unknown, signing = false) {
  const fields = documentDefinitions[kind].fields;
  const payload = z.object(Object.fromEntries(fields.map(field => [field.key, z.string().trim().max(field.type === "textarea" ? 4000 : 300).default("")]))).strict().parse(input) as Record<string, string>;
  for (const field of fields) {
    const value = payload[field.key];
    if (signing && field.required && !value) throw Object.assign(new Error(`${field.label} is required before signing`), { status: 422 });
    if (value && field.type === "date") z.iso.date().parse(value);
    if (value && field.type === "datetime-local") {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw Object.assign(new Error(`${field.label} must be a valid date and time`), { status: 422 });
      z.iso.date().parse(value.slice(0, 10));
      if (+value.slice(11, 13) > 23 || +value.slice(14) > 59) throw Object.assign(new Error("Invalid time"), { status: 422 });
    }
  }
  if (kind === "SICK" && payload.restFrom && payload.restTo && payload.restTo < payload.restFrom) throw Object.assign(new Error("Rest end date cannot precede its start"), { status: 422 });
  return payload;
}
export function assertDocumentEditable(status: string, version: number, expected: number) {
  if (status !== "DRAFT") throw Object.assign(new Error("Signed content is locked. Create a correction revision."), { status: 409 });
  if (version !== expected) throw Object.assign(new Error("This draft changed. Reload it before continuing."), { status: 409 });
}
