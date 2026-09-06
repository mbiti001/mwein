import { describe, expect, it } from "vitest";
import { shaGatewayReadiness } from "./sha";

describe("SHA integration guardrail", () => {
  it("cannot report ready before authenticated transport is implemented", () => {
    expect(shaGatewayReadiness().ready).toBe(false);
    expect(shaGatewayReadiness().checks.transportImplemented).toBe(false);
  });
});
