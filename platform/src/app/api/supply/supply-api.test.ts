import { beforeEach, describe, expect, it, vi } from "vitest";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const facilityId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const storeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const stocktakeId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const lineId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const batchId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    facilityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    displayName: "Independent manager",
    permissions: ["inventory.reconcile", "accounting.view"],
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    supplyOperation: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));

import { db } from "@/lib/db";
import { POST } from "./route";

const transactionMock = db.$transaction as unknown as ReturnType<typeof vi.fn>;
const replayMock = db.supplyOperation.findUnique as unknown as ReturnType<typeof vi.fn>;

function request(body: unknown) {
  return new Request("http://localhost/api/supply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("supply stocktake API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockReset();
    replayMock.mockResolvedValue(null);
  });

  it("opens a blind full-store stocktake from a balance snapshot", async () => {
    const create = vi.fn().mockResolvedValue({
      id: stocktakeId,
      stocktakeNumber: "MMS-STK-2026-000001",
      storeId,
      lines: [{ id: lineId }],
    });
    const tx = {
      store: { findFirst: vi.fn().mockResolvedValue({ id: storeId, name: "Main pharmacy" }) },
      stocktake: { findFirst: vi.fn().mockResolvedValue(null), create },
      inventoryLocationBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            batchId,
            quantity: "12.000",
            batch: {
              unitCost: "25.00",
              expiryDate: new Date("2027-01-01"),
              catalogItem: { code: "PARA500", name: "Paracetamol 500 mg" },
            },
          },
        ]),
      },
      facility: { findUniqueOrThrow: vi.fn().mockResolvedValue({ code: "MMS" }) },
      referenceSequence: { upsert: vi.fn().mockResolvedValue({ nextValue: 2n }) },
      supplyOperation: { create: vi.fn() },
    };
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const response = await POST(request({
      action: "START_STOCKTAKE",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      storeId,
      notes: "Month-end count",
    }));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        storeId,
        openedById: userId,
        lines: { create: [{ batchId, systemQuantity: "12.000", unitCost: "25.00" }] },
      }),
    }));
    expect(tx.supplyOperation.create).toHaveBeenCalled();
  });

  it("requires every blind-count line before submission", async () => {
    const tx = {
      stocktake: {
        findFirst: vi.fn().mockResolvedValue({
          id: stocktakeId,
          status: "OPEN",
          lines: [
            { id: lineId, systemQuantity: "12", batch: { batchNumber: "B1", catalogItem: { name: "Paracetamol" } } },
            { id: "99999999-9999-4999-8999-999999999999", systemQuantity: "4", batch: { batchNumber: "B2", catalogItem: { name: "Amoxicillin" } } },
          ],
        }),
      },
    };
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const response = await POST(request({
      action: "SUBMIT_STOCKTAKE",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      stocktakeId,
      lines: [{ lineId, countedQuantity: 12 }],
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Count every") });
  });

  it("posts an independently approved variance and balanced accounting journal", async () => {
    const movementId = "12121212-1212-4121-8121-121212121212";
    const journalCreate = vi.fn().mockResolvedValue({ id: "journal-1" });
    const tx = {
      stocktake: {
        findFirst: vi.fn().mockResolvedValue({
          id: stocktakeId,
          facilityId,
          storeId,
          stocktakeNumber: "MMS-STK-2026-000001",
          status: "SUBMITTED",
          openedById: "13131313-1313-4131-8131-131313131313",
          submittedById: "14141414-1414-4141-8141-141414141414",
          store: { id: storeId, name: "Main pharmacy" },
          lines: [{
            id: lineId,
            batchId,
            systemQuantity: "12",
            countedQuantity: "10",
            variance: "-2",
            unitCost: "25",
            reason: "Damaged packs",
            batch: { batchNumber: "B1", catalogItem: { id: "15151515-1515-4151-8151-151515151515", name: "Paracetamol" } },
          }],
        }),
        update: vi.fn().mockResolvedValue({ id: stocktakeId, stocktakeNumber: "MMS-STK-2026-000001", status: "POSTED" }),
      },
      inventoryLocationBalance: {
        findUnique: vi.fn().mockResolvedValue({ id: "balance-1", quantity: "12" }),
        update: vi.fn(),
      },
      inventoryBatch: {
        update: vi.fn()
          .mockResolvedValueOnce({ id: batchId, quantityAvailable: "10", unitCost: "25" })
          .mockResolvedValueOnce({ id: batchId, quantityAvailable: "10", unitCost: "25" }),
      },
      stockMovement: { create: vi.fn().mockResolvedValue({ id: movementId, occurredAt: new Date("2026-09-08T09:00:00Z") }) },
      accountingJournal: { create: journalCreate },
      inventoryControlEvent: { updateMany: vi.fn() },
      supplyOperation: { create: vi.fn() },
    };
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const response = await POST(request({
      action: "APPROVE_STOCKTAKE",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      stocktakeId,
    }));

    expect(response.status).toBe(201);
    expect(tx.inventoryLocationBalance.update).toHaveBeenCalledWith({ where: { id: "balance-1" }, data: { quantity: "10" } });
    expect(journalCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceId: movementId,
        lines: { create: expect.arrayContaining([
          expect.objectContaining({ accountCode: "5090", debit: expect.anything() }),
          expect.objectContaining({ accountCode: "1300", credit: expect.anything() }),
        ]) },
      }),
    }));
  });

  it("blocks the opener or counter from approving their own stocktake", async () => {
    const tx = {
      stocktake: {
        findFirst: vi.fn().mockResolvedValue({
          id: stocktakeId,
          status: "SUBMITTED",
          openedById: userId,
          submittedById: "14141414-1414-4141-8141-141414141414",
          lines: [],
        }),
      },
    };
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const response = await POST(request({
      action: "APPROVE_STOCKTAKE",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      stocktakeId,
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Maker-checker") });
  });
});
