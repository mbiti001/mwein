import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferralRow, type Referral } from "./ServicePointsWorkstation";

const referral: Referral = {
  id: "referral-1",
  referralNumber: "MMS-REF-2026-000001",
  type: "EXTERNAL",
  referrerName: "Dr Referrer",
  referringFacility: "Mwein Medical Services",
  reason: "Specialist review",
  clinicalSummary: "Persistent symptoms despite treatment",
  diagnosisSummary: "Suspected pneumonia",
  urgency: "PRIORITY",
  attachments: [
    {
      id: "attachment-1",
      sourceType: "LABORATORY_RESULT",
      resultId: "33333333-3333-4333-8333-333333333333",
      href: "/api/clinical-results/laboratory/33333333-3333-4333-8333-333333333333",
      metadataVersion: 1,
      metadata: {
        displayName: "Full blood count",
        orderId: "order-1",
        resultStatus: "VERIFIED",
        verifiedAt: "2026-09-08T07:00:00.000Z",
      },
      attachedAt: "2026-09-08T07:10:00.000Z",
      attachedBy: { displayName: "Dr Referrer" },
    },
  ],
  acknowledgements: [
    {
      id: "ack-1",
      eventType: "ACCEPTED",
      referralStatus: "ACCEPTED",
      providerName: "Dr Amina Noor",
      providerRole: "Medical officer",
      registrationNumber: "KMPDC-1001",
      note: "Referral received and prioritised.",
      acknowledgedAt: "2026-09-08T08:00:00.000Z",
      recordedAt: "2026-09-08T08:01:00.000Z",
      recordedBy: { displayName: "Records officer" },
    },
  ],
  receivingFacility: "County referral hospital",
  status: "ACCEPTED",
  createdAt: "2026-09-08T06:00:00.000Z",
  patient: {
    id: "patient-1",
    patientNumber: "MMS-P-1",
    fullName: "Test Patient",
    sexAtBirth: "FEMALE",
  },
  visit: {
    id: "visit-1",
    visitNumber: "MMS-V-1",
    clinic: "Walk-in",
    arrivedAt: "2026-09-08T05:00:00.000Z",
  },
  createdBy: { displayName: "Dr Referrer" },
  updatedBy: { displayName: "Records officer" },
};

describe("referral UI", () => {
  it("renders source-record links, metadata version and acknowledgement history", () => {
    const html = renderToStaticMarkup(
      createElement(ReferralRow, {
        referral,
        onUpdated: async () => undefined,
        onPrint: () => undefined,
      }),
    );
    expect(html).toContain(
      'href="/api/clinical-results/laboratory/33333333-3333-4333-8333-333333333333"',
    );
    expect(html).toContain("metadata v1");
    expect(html).toContain("Receiving-provider acknowledgement trail");
    expect(html).toContain("Dr Amina Noor");
    expect(html).toContain("Provider name");
  });
});
