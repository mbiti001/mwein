import { describe, expect, it } from "vitest";
import { apiFailureMessage } from "./client-http";

describe("API failure messages", () => {
  it("returns the field and validation reason", () => {
    expect(apiFailureMessage({ error: "Validation failed", issues: [{ path: ["data", "quantity"], message: "Must be greater than 0" }] }, "Save failed"))
      .toBe("Validation failed. quantity: Must be greater than 0");
  });

  it("uses a safe fallback when the server has no JSON error", () => {
    expect(apiFailureMessage({}, "Save failed")).toBe("Save failed");
  });

  it("includes the server's actionable reason", () => {
    expect(apiFailureMessage({ error: "The record could not be saved", reason: "It was changed after this page was opened" }, "Save failed"))
      .toBe("The record could not be saved. It was changed after this page was opened");
  });
});
