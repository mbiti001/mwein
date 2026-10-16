import { describe, expect, it } from "vitest";
import { isRetryableTransactionConflict } from "./transaction-conflict";

describe("structured transaction conflicts", () => {
  it.each([
    { code: "P2034" },
    { code: "P2010", meta: { code: "40001", message: "Localized server message" } },
    { code: "P2010", meta: { code: "40P01" } },
  ])("recognizes the documented aborted-transaction shape %j", error => {
    expect(isRetryableTransactionConflict(error)).toBe(true);
  });
  it.each([
    null, undefined, "P2034", 40001, {}, new Error("40001 serialization failure"),
    { code: "P2002" }, { code: "P1001" }, { code: "ECONNRESET" },
    { code: "40001" }, { meta: { code: "40001" } },
    { code: "P2010" }, { code: "P2010", meta: null },
    { code: "P2010", meta: "40001" }, { code: "P2010", meta: { code: 40001 } },
    { code: "P2010", meta: { message: "40001" } },
    { code: "P2010", meta: { code: "P0001", message: "40001" } },
    { code: "P2010", meta: { code: "23505" } },
    { code: "P2010", meta: { code: "08006" } },
    { code: "P2010", meta: { code: "25P02" } },
    { code: "P2010", meta: { code: "unknown" } },
    { code: "P1001", meta: { code: "40001" } },
  ])("does not broaden retry to other errors %j", error => {
    expect(isRetryableTransactionConflict(error)).toBe(false);
  });
});
