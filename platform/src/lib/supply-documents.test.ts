import { describe, expect, it } from "vitest";
import { supplyDocumentStatus } from "./supply-documents";

describe("printed supply document authority", () => {
  it.each(["DRAFT", "SUBMITTED", "UNKNOWN"])("does not authorise a %s order", status => {
    expect(supplyDocumentStatus({ kind: "PURCHASE_ORDER", status })).toContain("NOT AUTHORISED");
  });
  it("explicitly prohibits supply on cancelled orders", () => {
    expect(supplyDocumentStatus({ kind: "PURCHASE_ORDER", status: "CANCELLED" })).toBe("CANCELLED — DO NOT SUPPLY");
  });
  it("distinguishes a posted receipt from an approved order", () => {
    expect(supplyDocumentStatus({ kind: "GOODS_RECEIPT", status: "POSTED" })).toBe("POSTED RECEIPT");
    expect(supplyDocumentStatus({ kind: "PURCHASE_ORDER", status: "PARTIALLY_RECEIVED" })).toBe("PARTIALLY RECEIVED");
  });
});
