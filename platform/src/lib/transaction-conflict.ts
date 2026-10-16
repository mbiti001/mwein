/** Classify known aborted transactions, never ambiguous network outcomes. */
export function isRetryableTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  if (code === "P2034") return true;
  if (code !== "P2010" || !meta || typeof meta !== "object") return false;
  const sqlState = (meta as { code?: unknown }).code;
  // PostgreSQL requires a fresh complete transaction for serialization failures;
  // deadlocks also abort the transaction. Do not infer either from message text.
  // https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html
  return sqlState === "40001" || sqlState === "40P01";
}
