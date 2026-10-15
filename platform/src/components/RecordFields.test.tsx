import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordFields, recordValue } from "./RecordFields";
import { ClinicFormPaper } from "./ClinicForms";
import { documentDefinitions, documentKinds } from "@/lib/clinic-documents";

describe("record presentation without invented findings", () => {
  it("omits absent values and entire empty sections while retaining zero and explicit negatives", () => {
    expect(renderToStaticMarkup(<RecordFields title="Empty section" fields={[{ label: "Blank", value: "  " }, { label: "Missing", value: null }]} />)).toBe("");
    const html = renderToStaticMarkup(<RecordFields fields={[
      { label: "Count", value: 0 }, { label: "Confirmed", value: false },
      { label: "Present", value: true }, { label: "Finding", value: "Absent" },
      { label: "Unassessed", value: "Not examined", omitUnassessed: true },
      { label: "Pending work", value: "Not recorded" },
      { label: "Explanation", value: "Not examined due to pain", omitUnassessed: true },
    ]} />);
    for (const text of [">0<", ">No<", ">Yes<", "Absent", "Not recorded", "Not examined due to pain"]) expect(html).toContain(text);
    expect(html).not.toContain("Unassessed");
    for (const value of [undefined, null, NaN, {}, []]) expect(recordValue(value)).toBeNull();
  });

  it.each(documentKinds)("keeps signed %s content and attribution without optional empty labels", kind => {
    const definition = documentDefinitions[kind];
    const payload = Object.fromEntries(definition.fields.map(field => [field.key, field.required ? `Recorded ${field.label}` : "  "]));
    const html = renderToStaticMarkup(<ClinicFormPaper document={{
      id: "synthetic", kind, reference: "TEST-001", status: "SIGNED", revision: 2, version: 3, payload,
      context: { facilityName: "Synthetic clinic", facilityCode: "TEST", timezone: "Africa/Nairobi" },
      previousId: "original", previous: { reference: "TEST-SICK-2026-000001" }, correctionReason: "Documented correction", signedAt: "2026-10-15T09:00:00Z",
      signerName: "Test signer", signerRoles: ["Clinician"], contentHash: "retained-fingerprint",
    }} />);
    for (const field of definition.fields) {
      if (field.required) expect(html).toContain(`Recorded ${field.label}`);
      else expect(html).not.toContain(field.label);
    }
    for (const text of [">Signed<", "<dt>Revision</dt><dd>2</dd>", "TEST-SICK-2026-000001", "Test signer", "Documented correction", "retained-fingerprint"]) expect(html).toContain(text);
    expect(html).not.toContain("Not recorded");
  });
});
