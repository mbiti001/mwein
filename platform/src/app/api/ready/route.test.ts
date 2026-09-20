import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { $queryRaw: vi.fn(), facility: { findMany: vi.fn() } } }));
vi.mock("@/lib/governance", () => ({ governanceReadiness: vi.fn(), productionConfigurationReadiness: vi.fn() }));
import { db } from "@/lib/db";
import { governanceReadiness, productionConfigurationReadiness } from "@/lib/governance";
import { GET } from "./route";

describe("public readiness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.facility.findMany).mockResolvedValue([{ code: "PRIVATE_FACILITY", governanceEvidence: [] }] as any);
    vi.mocked(productionConfigurationReadiness).mockReturnValue({ ready: true, checks: [] });
    vi.mocked(governanceReadiness).mockReturnValue({ ready: true, approved: 11, total: 11, gates: [] });
  });
  it("reports success without disclosing facility or configuration details", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns the same minimal blocked response for missing evidence and database failure", async () => {
    vi.mocked(governanceReadiness).mockReturnValue({ ready: false, approved: 0, total: 11, gates: [] });
    const blocked = await GET();
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toEqual({ status: "blocked" });
    vi.mocked(db.$queryRaw).mockRejectedValue(new Error("sensitive connection details"));
    const failed = await GET();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ status: "blocked" });
  });
});
