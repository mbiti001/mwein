import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    facilityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    displayName: "Test clinician",
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    laboratoryResult: { findFirst: vi.fn() },
    imagingResult: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));

import { db } from "@/lib/db";
import { GET as GETClinicalResult } from "../clinical-results/[kind]/[id]/route";
import { PATCH } from "./[id]/route";
import { POST } from "./route";

const transactionMock = db.$transaction as unknown as ReturnType<typeof vi.fn>;
const laboratoryResultFindMock = db.laboratoryResult.findFirst as unknown as ReturnType<typeof vi.fn>;

const validReferral = {
  visitId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  type: "EXTERNAL",
  reason: "Specialist review",
  clinicalSummary: "Persistent symptoms despite initial treatment.",
  diagnosisSummary: "Suspected pneumonia",
  urgency: "PRIORITY",
  receivingFacility: "County referral hospital",
};

describe("referral API contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockReset();
    laboratoryResultFindMock.mockReset();
  });

  it("rejects legacy result-label payloads before opening a transaction", async () => {
    const response = await POST(
      new Request("http://localhost/api/referrals", {
        method: "POST",
        body: JSON.stringify({
          ...validReferral,
          attachedResults: ["Full blood count — completed"],
        }),
      }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "Validation failed" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("creates a referral with a versioned link to a verified visit result", async () => {
    const resultId = "33333333-3333-4333-8333-333333333333";
    const attachedAt = new Date("2026-09-08T07:10:00.000Z");
    const verifiedAt = new Date("2026-09-08T07:00:00.000Z");
    const create = vi.fn().mockResolvedValue({
      id: "referral-1",
      facilityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      legacyAttachedResults: [],
      attachments: [
        {
          id: "attachment-1",
          sourceType: "LABORATORY_RESULT",
          laboratoryResultId: resultId,
          imagingResultId: null,
          metadataVersion: 1,
          metadata: { displayName: "Full blood count" },
          attachedAt,
          attachedBy: { displayName: "Test clinician" },
        },
      ],
      acknowledgements: [],
    });
    const tx = {
      referral: { findUnique: vi.fn().mockResolvedValue(null), create },
      visit: {
        findFirst: vi.fn().mockResolvedValue({
          id: validReferral.visitId,
          facilityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          patientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          status: "AWAITING_CLINICIAN",
          encounters: [],
        }),
      },
      laboratoryResult: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: resultId,
            status: "VERIFIED",
            verifiedAt,
            laboratoryOrder: {
              testCode: "FBC",
              accessionNumber: "LAB-1001",
              order: { id: "order-1", displayName: "Full blood count" },
            },
          },
        ]),
      },
      imagingResult: { findMany: vi.fn().mockResolvedValue([]) },
      facility: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ code: "MMS", name: "Mwein" }),
      },
      referenceSequence: {
        upsert: vi.fn().mockResolvedValue({ nextValue: 2n }),
      },
      auditEvent: { create: vi.fn() },
    };
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const response = await POST(
      new Request("http://localhost/api/referrals", {
        method: "POST",
        body: JSON.stringify({
          ...validReferral,
          attachments: [{ sourceType: "LABORATORY_RESULT", resultId }],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      referral: {
        attachments: [
          {
            resultId,
            metadataVersion: 1,
            href: `/api/clinical-results/laboratory/${resultId}`,
          },
        ],
      },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        attachments: {
          create: [
            expect.objectContaining({
              sourceType: "LABORATORY_RESULT",
              metadataVersion: 1,
              laboratoryResult: { connect: { id: resultId } },
            }),
          ],
        },
      }),
    }));
  });

  it("rejects an acceptance transition without provider acknowledgement", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/referrals/referral-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "ACCEPTED" }),
      }),
      { params: Promise.resolve({ id: "referral-1" }) },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "Validation failed",
      reason: expect.stringContaining("acknowledgement"),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("appends provider identity when the receiving facility accepts", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "referral-1",
      status: "ACCEPTED",
      legacyAttachedResults: [],
      attachments: [],
      acknowledgements: [
        {
          id: "ack-1",
          eventType: "ACCEPTED",
          providerName: "Dr Amina Noor",
          acknowledgedAt: new Date("2020-01-01T08:00:00.000Z"),
          recordedBy: { displayName: "Test clinician" },
        },
      ],
    });
    const tx = {
      referral: {
        findFirst: vi.fn().mockResolvedValue({ id: "referral-1", status: "SENT" }),
        update,
      },
      auditEvent: { create: vi.fn() },
    };
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const response = await PATCH(
      new Request("http://localhost/api/referrals/referral-1", {
        method: "PATCH",
        body: JSON.stringify({
          status: "ACCEPTED",
          acknowledgement: {
            providerName: "Dr Amina Noor",
            providerRole: "Medical officer",
            registrationNumber: "KMPDC-1001",
            acknowledgedAt: "2020-01-01T08:00:00.000Z",
          },
        }),
      }),
      { params: Promise.resolve({ id: "referral-1" }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "ACCEPTED",
        acknowledgements: {
          create: expect.objectContaining({
            eventType: "ACCEPTED",
            providerName: "Dr Amina Noor",
            recordedById: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          }),
        },
      }),
    }));
    expect(await response.json()).toMatchObject({
      referral: {
        status: "ACCEPTED",
        acknowledgements: [{ providerName: "Dr Amina Noor" }],
      },
    });
  });

  it("resolves an attachment URL to the verified underlying clinical record", async () => {
    const resultId = "33333333-3333-4333-8333-333333333333";
    laboratoryResultFindMock.mockResolvedValue({
      id: resultId,
      status: "VERIFIED",
      items: [{ analyte: "Haemoglobin", value: "13.2", unit: "g/dL" }],
      laboratoryOrder: {
        accessionNumber: "LAB-1001",
        order: {
          displayName: "Full blood count",
          visit: { visitNumber: "MMS-V-1", patient: { patientNumber: "MMS-P-1", fullName: "Test Patient" } },
        },
      },
    });

    const response = await GETClinicalResult(
      new Request(`http://localhost/api/clinical-results/laboratory/${resultId}`),
      { params: Promise.resolve({ kind: "laboratory", id: resultId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "LABORATORY_RESULT",
      record: { id: resultId, status: "VERIFIED" },
    });
    expect(laboratoryResultFindMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: resultId,
        status: "VERIFIED",
        laboratoryOrder: { order: { visit: { facilityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } } },
      }),
    }));
  });
});
