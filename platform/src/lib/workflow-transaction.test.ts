import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ db: { $transaction: vi.fn() } }));
import { db } from "./db";
import { workflowTransaction } from "./workflow-transaction";

beforeEach(() => vi.resetAllMocks());
const conflicts = [{ code: "P2034" }, { code: "P2010", meta: { code: "40001" } }, { code: "P2010", meta: { code: "40P01" } }];
describe("whole workflow transaction retry", () => {
  it.each(conflicts)("starts a fresh transaction and reruns all work after %j", async conflict => {
    const transactions: object[] = [];
    const reads = vi.fn(); const writes = vi.fn(); const audits = vi.fn();
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
      const tx = { attempt: transactions.length + 1 }; transactions.push(tx);
      return callback(tx);
    });
    const work = vi.fn(async (tx: Prisma.TransactionClient) => {
      reads(tx); writes(tx); audits(tx);
      if (transactions.length === 1) throw conflict;
      return "confirmed result";
    });
    expect(await workflowTransaction(work)).toBe("confirmed result");
    expect(transactions).toHaveLength(2); expect(transactions[0]).not.toBe(transactions[1]);
    for (const operation of [work, reads, writes, audits]) {
      expect(operation).toHaveBeenCalledTimes(2);
      expect(operation.mock.calls.map(call => call[0])).toEqual(transactions);
    }
    for (const call of vi.mocked(db.$transaction).mock.calls) expect(call[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });
  it.each(conflicts)("throws the final original failure after three total attempts: %j", async conflict => {
    const failures = Array.from({ length: 3 }, (_, attempt) => ({ ...conflict, attempt }));
    const work = vi.fn();
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
      await callback({}); throw failures[work.mock.calls.length - 1];
    });
    await expect(workflowTransaction(work)).rejects.toBe(failures[2]);
    expect(work).toHaveBeenCalledTimes(3); expect(db.$transaction).toHaveBeenCalledTimes(3);
  });
  it.each([
    { code: "P2002" }, { code: "P1001" }, { code: "ECONNRESET" },
    { code: "P2010", meta: { code: "P0001" } }, { code: "P2010", meta: { code: "unknown" } },
    new Error("40001"), null,
  ])("propagates nonconflict failure without retry: %j", async error => {
    const work = vi.fn().mockRejectedValue(error);
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback({}));
    await expect(workflowTransaction(work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1); expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
