import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
import { recordDisclosure } from "./disclosure-audit";
import { auditedOperationalJson } from "./audited-json";
const actor = { id: "actor", facilityId: "facility", sessionId: "session" };
beforeEach(() => vi.resetAllMocks());
it("awaits disclosure recording and returns a private response", async () => {
  const body = { confidential: "synthetic" };
  const response = await auditedOperationalJson(actor, "inventory", body);
  expect(recordDisclosure).toHaveBeenCalledWith(actor, "OPERATIONS_READ:inventory", [], body);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(body);
});
it("does not produce a response when auditing fails", async () => {
  vi.mocked(recordDisclosure).mockRejectedValue(new Error("Audit unavailable"));
  await expect(auditedOperationalJson(actor, "staff", { private: true })).rejects.toThrow("Audit unavailable");
});
