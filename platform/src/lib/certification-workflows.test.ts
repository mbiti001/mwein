import { describe, expect, it } from "vitest";
import { canTransitionRightsRequest, exchangeRetryAt, exchangeTransportConfiguration, requiresRightsOutcome, rightsRequestDueAt, stablePayloadHash } from "./certification-workflows";

describe("certification workflows", () => {
  it("sets and enforces a controlled patient-rights lifecycle", () => {
    expect(rightsRequestDueAt(new Date("2026-09-22T00:00:00Z")).toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(canTransitionRightsRequest("RECEIVED", "IN_REVIEW")).toBe(true);
    expect(canTransitionRightsRequest("RECEIVED", "COMPLETED")).toBe(false);
    expect(canTransitionRightsRequest("COMPLETED", "IN_REVIEW")).toBe(false);
    expect(requiresRightsOutcome("DENIED")).toBe(true);
  });

  it("hashes payloads and caps exponential retry at one day", () => {
    expect(stablePayloadHash({ resourceType: "Patient", id: "1" })).toHaveLength(64);
    expect(exchangeRetryAt(0, new Date("2026-09-22T00:00:00Z")).toISOString()).toBe("2026-09-22T00:05:00.000Z");
    expect(exchangeRetryAt(20, new Date("2026-09-22T00:00:00Z")).toISOString()).toBe("2026-09-23T00:00:00.000Z");
  });

  it("keeps national transports fail-closed", () => {
    expect(exchangeTransportConfiguration("DHA_FHIR", {})).toEqual({ enabled: false, endpoint: "", token: "", ready: false });
    expect(exchangeTransportConfiguration("DHA_FHIR", { DHA_FHIR_TRANSPORT_ENABLED: "true", DHA_FHIR_ENDPOINT: "https://sandbox.example/fhir", DHA_FHIR_ACCESS_TOKEN: "1234567890123456" }).ready).toBe(true);
  });
});
