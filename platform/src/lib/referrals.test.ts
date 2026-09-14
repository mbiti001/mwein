import { describe, expect, it } from "vitest";
import {
  referralAttachmentHref,
  referralInput,
  referralStatusInput,
} from "./referrals";

const referral = {
  visitId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  type: "EXTERNAL",
  reason: "Specialist review",
  clinicalSummary: "Persistent symptoms despite initial treatment.",
  diagnosisSummary: "Suspected pneumonia",
  urgency: "PRIORITY",
  receivingFacility: "County referral hospital",
};

describe("referral contracts", () => {
  it("accepts immutable result references and rejects legacy result labels", () => {
    expect(
      referralInput.parse({
        ...referral,
        attachments: [
          {
            sourceType: "LABORATORY_RESULT",
            resultId: "33333333-3333-4333-8333-333333333333",
          },
        ],
      }).attachments,
    ).toHaveLength(1);
    expect(() =>
      referralInput.parse({ ...referral, attachedResults: ["FBC — completed"] }),
    ).toThrow();
  });

  it("requires a provider acknowledgement for receiving-side transitions", () => {
    expect(referralStatusInput.safeParse({ status: "ACCEPTED" }).success).toBe(false);
    expect(
      referralStatusInput.safeParse({
        status: "ACCEPTED",
        acknowledgement: { providerName: "Dr Amina Noor" },
      }).success,
    ).toBe(true);
    expect(referralStatusInput.safeParse({ status: "SENT" }).success).toBe(true);
  });

  it("builds stable record URLs from result identifiers", () => {
    expect(referralAttachmentHref("LABORATORY_RESULT", "lab-1")).toBe(
      "/api/clinical-results/laboratory/lab-1",
    );
    expect(referralAttachmentHref("IMAGING_RESULT", "image-1")).toBe(
      "/api/clinical-results/imaging/image-1",
    );
  });
});
