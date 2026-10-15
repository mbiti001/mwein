import { Prisma } from "@prisma/client";
import { db } from "./db";

export async function workflowTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt >= 2) throw error;
    }
  }
}
