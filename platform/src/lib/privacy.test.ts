import { describe, expect, it } from "vitest";
import { canTransitionDataSubjectRequest } from "./privacy";

describe("data-subject request transitions", () => {
  it("requires identity verification before review", () => {
    expect(canTransitionDataSubjectRequest("RECEIVED", "IDENTITY_VERIFIED")).toBe(true);
    expect(canTransitionDataSubjectRequest("RECEIVED", "IN_REVIEW")).toBe(false);
  });

  it("does not reopen a terminal request", () => {
    expect(canTransitionDataSubjectRequest("COMPLETED", "IN_REVIEW")).toBe(false);
    expect(canTransitionDataSubjectRequest("DENIED", "RECEIVED")).toBe(false);
  });
});
