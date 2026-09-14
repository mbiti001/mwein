import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ConsultationForm,
  type ConsultationVisit,
} from "./ConsultationWorkstation";

const visit: ConsultationVisit = {
  id: "visit-1",
  visitNumber: "MMS-V-2026-000001",
  clinic: "Outpatient",
  priority: "ROUTINE",
  arrivedAt: "2026-09-08T08:00:00.000Z",
  patient: {
    id: "patient-1",
    fullName: "Amina Patient",
    patientNumber: "MMS-P-2026-000001",
    sexAtBirth: "FEMALE",
    dateOfBirth: "1992-04-14",
    contacts: [{ type: "PHONE", value: "+254700000001", primary: true }],
    identifiers: [{ type: "SHA", value: "SHA-0001" }],
    allergies: [],
  },
  encounters: [
    {
      id: "encounter-1",
      status: "DRAFT",
      subjective: JSON.stringify({
        chiefComplaint: "Cough",
        complaints: [
          { complaint: "Cough", durationValue: 3, durationUnit: "DAYS" },
          {
            complaint: "Headache",
            durationValue: 6,
            durationUnit: "HOURS",
          },
        ],
        historyPresentingIllness: "Symptoms began this week.",
      }),
      objective: JSON.stringify({}),
      plan: JSON.stringify({}),
      diagnoses: [],
    },
  ],
  invoice: { claims: [] },
};

describe("consultation workspace", () => {
  it("renders structured complaints and at-a-glance patient context", () => {
    const html = renderToStaticMarkup(
      createElement(ConsultationForm, {
        visit,
        onBack: () => undefined,
        onCompleted: () => undefined,
      }),
    );

    expect(html).toContain("Presenting complaints");
    expect(html).toContain('value="Cough"');
    expect(html).toContain('value="Headache"');
    expect(html).toContain("+254700000001");
    expect(html).toContain("SHA · SHA-0001");
    expect(html).toContain("No active allergies recorded");
  });
});
