import { Prisma } from "@prisma/client";
import { db } from "./db";
import { isRetryableTransactionConflict } from "./transaction-conflict";

export async function workflowTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (!isRetryableTransactionConflict(error) || attempt >= 2) throw error;
      // Wait outside the aborted transaction so competing audit writers can finish.
      const baseDelayMs = 20 * 2 ** attempt;
      await new Promise<void>(resolve =>
        setTimeout(resolve, baseDelayMs + Math.floor(Math.random() * (baseDelayMs + 1))));
    }
  }
}
