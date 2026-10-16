import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ db: { $transaction: vi.fn() } }));
import { db } from "./db";
import { workflowTransaction } from "./workflow-transaction";

beforeEach(() => vi.resetAllMocks());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const conflicts = [{ code: "P2034" }, { code: "P2010", meta: { code: "40001" } }, { code: "P2010", meta: { code: "40P01" } }];
describe("whole workflow transaction retry", () => {
  it.each(conflicts.flatMap(conflict => [0, 0.5, 0.999999].map(random => ({ conflict, random }))))("waits outside aborted transactions before each bounded retry: $conflict, jitter $random", async ({ conflict, random }) => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(random);
    let activeTransactions = 0;
    const activeWhenScheduled: number[] = [];
    const schedule = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
      activeWhenScheduled.push(activeTransactions);
      return schedule(...args);
    }) as typeof setTimeout);
    const failures = Array.from({ length: 3 }, (_, attempt) => ({ ...conflict, attempt }));
    const work = vi.fn();
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
      activeTransactions++;
      try { await callback({}); throw failures[work.mock.calls.length - 1]; }
      finally { activeTransactions--; }
    });
    // Observe rejection immediately so the deliberately failing third attempt is handled.
    const result = workflowTransaction(work).then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(0);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(timer).toHaveBeenCalledTimes(1);
    expect(activeTransactions).toBe(0);

    for (const [retryIndex, minimum, maximum] of [[0, 20, 40], [1, 40, 80]]) {
      const delay = Number(timer.mock.calls[retryIndex][1]);
      expect(delay).toBeGreaterThanOrEqual(minimum);
      expect(delay).toBeLessThanOrEqual(maximum);
      if (random === 0) expect(delay).toBe(minimum);
      if (random === 0.999999) expect(delay).toBe(maximum);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(db.$transaction).toHaveBeenCalledTimes(retryIndex + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(db.$transaction).toHaveBeenCalledTimes(retryIndex + 2);
      expect(activeTransactions).toBe(0);
    }
    const settled = await result;
    expect(settled).toEqual({ error: failures[2] });
    expect((settled as { error: unknown }).error).toBe(failures[2]);
    expect(work).toHaveBeenCalledTimes(3);
    expect(timer).toHaveBeenCalledTimes(2);
    expect(activeWhenScheduled).toEqual([0, 0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns success immediately without scheduling a retry", async () => {
    vi.useFakeTimers();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const work = vi.fn().mockResolvedValue("saved");
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback({}));
    expect(await workflowTransaction(work)).toBe("saved");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(timer).not.toHaveBeenCalled();
  });
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
    vi.useFakeTimers();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const work = vi.fn().mockRejectedValue(error);
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback({}));
    await expect(workflowTransaction(work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1); expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(timer).not.toHaveBeenCalled();
  });
});
