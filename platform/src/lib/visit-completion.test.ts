import { describe, expect, it } from "vitest";
import { visitCompletionBlockers } from "./visit-completion";

const ready = { status: "AWAITING_PAYMENT", encounters: [{ status: "SIGNED" }], orders: [{ status: "COMPLETED", displayName: "FBC" }], invoice: { status: "PAID", items: [{ quantity: 1, unitPrice: 500 }], payments: [{ status: "CONFIRMED", amount: 500 }], claims: [] } };

describe("visit completion", () => {
  it("allows a clinically and financially complete visit", () => expect(visitCompletionBlockers(ready)).toEqual([]));
  it("returns actionable clinical, order and billing blockers", () => {
    const blockers = visitCompletionBlockers({ ...ready, encounters: [], orders: [{ status: "REQUESTED", displayName: "X-ray" }], invoice: { ...ready.invoice, payments: [] } });
    expect(blockers).toContain("Clinical consultation is not signed");
    expect(blockers.join(" ")).toContain("X-ray");
    expect(blockers.join(" ")).toContain("500.00");
  });
});
