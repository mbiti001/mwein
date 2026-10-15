import { describe, expect, it, vi } from "vitest";
import { verifyRelease } from "./verify-release.mjs";
const config = { origin: "https://app.example", expectedCommit: "release-sha", expectedMigration: "migration-head", patientUse: true };
const health = () => Response.json({ release: { commit: config.expectedCommit }, migration: config.expectedMigration });
describe("patient-use release verification", () => {
  it("checks numbered release identity independently of source and readiness", async () => {
    const request = vi.fn().mockImplementation(async () => Response.json({ release: { commit: config.expectedCommit, version: "1.1.0" }, migration: config.expectedMigration }));
    await expect(verifyRelease({ ...config, patientUse: false, expectedVersion: "1.1.0" }, request)).resolves.toMatchObject({ version: "1.1.0" });
    await expect(verifyRelease({ ...config, expectedVersion: "1.2.0" }, request)).rejects.toThrow("Version drift");
    await expect(verifyRelease({ ...config, expectedVersion: "1.1.0" }, vi.fn().mockResolvedValue(health()))).rejects.toThrow("Version drift");
  });
  it("rejects a healthy release whose patient-use gate is blocked", async () => {
    const request = vi.fn().mockResolvedValueOnce(health()).mockResolvedValueOnce(Response.json({ status: "blocked" }, { status: 503 }));
    await expect(verifyRelease(config, request)).rejects.toThrow("Patient-use verification blocked");
  });
  it("requires the expected identity and an explicitly ready response", async () => {
    const request = vi.fn().mockResolvedValueOnce(health()).mockResolvedValueOnce(Response.json({ status: "ready" }));
    await expect(verifyRelease(config, request)).resolves.toMatchObject({ patientReadinessChecked: true });
    expect(String(request.mock.calls[1][0])).toBe("https://app.example/api/ready");
  });
  it("rejects release drift before readiness checks", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ release: { commit: "other" }, migration: config.expectedMigration }));
    await expect(verifyRelease(config, request)).rejects.toThrow("Release drift");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not silently promote a health-only check to patient-use approval", async () => {
    const request = vi.fn().mockResolvedValue(health());
    await expect(verifyRelease({ ...config, patientUse: false }, request)).resolves.toMatchObject({ patientReadinessChecked: false });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects plaintext patient-use endpoints before sending requests", async () => {
    const request = vi.fn();
    await expect(verifyRelease({ ...config, origin: "http://app.example" }, request)).rejects.toThrow("HTTPS");
    expect(request).not.toHaveBeenCalled();
  });
});
