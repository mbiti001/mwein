import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), history: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/db", () => ({ db: { diagnosis: { findMany: mocks.history } } }));
vi.mock("@/lib/diagnosis-selection", () => ({ createDiagnosisSelectionToken: mocks.sign }));
const entity = { theCode: "1A00", title: "<em>Cholera</em>", id: "http://id.who.int/icd/release/11/2026-01/mms/257068234", foundationUri: "http://id.who.int/icd/entity/257068234" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("ICD11_CLIENT_ID", "test-client"); vi.stubEnv("ICD11_CLIENT_SECRET", "test-secret"); vi.stubEnv("ICD11_RELEASE", "2026-01");
  mocks.permission.mockResolvedValue({ facilityId: "facility-a" }); mocks.history.mockResolvedValue([]); mocks.sign.mockReturnValue("signed-selection");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function search() {
  const { GET } = await import("./route");
  return GET(new Request("https://example.test/api/diagnoses/search?q=cholera"));
}
describe("WHO ICD-11 connection", () => {
  it("returns signed release-specific results without secrets and reuses a valid token", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ access_token: "upstream-token", expires_in: 3600 })).mockImplementation(() => Promise.resolve(json({ destinationEntities: [entity] })));
    vi.stubGlobal("fetch", fetcher);
    const response = await search(); const body = await response.json();
    expect(body.results[0]).toMatchObject({ code: "1A00", title: "Cholera", codingVersion: "2026-01", selectionToken: "signed-selection" });
    expect(JSON.stringify(body)).not.toMatch(/test-secret|upstream-token/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await search(); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(mocks.sign).toHaveBeenCalledWith(expect.objectContaining({ facilityId: "facility-a" }));
  });
  it("refreshes a rejected token once before returning live results", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ access_token: "old", expires_in: 3600 })).mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ access_token: "new", expires_in: 3600 })).mockResolvedValueOnce(json({ destinationEntities: [entity] }));
    vi.stubGlobal("fetch", fetcher);
    expect((await (await search()).json()).source).toBe("WHO ICD-11"); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("fails over to facility-scoped history when WHO is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 503)));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await search();
      expect(await result.json()).toMatchObject({ source: "Facility history", upstreamUnavailable: true });
      expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ encounter: { visit: { facilityId: "facility-a" } } }) }));
    } finally { logger.mockRestore(); }
  });
  it("never caches a token beyond a short upstream lifetime", async () => {
    const fetcher = vi.fn().mockImplementation((url: string | URL) => Promise.resolve(String(url).includes("/connect/token") ? json({ access_token: "short-lived", expires_in: 15 }) : json({ destinationEntities: [entity] })));
    vi.stubGlobal("fetch", fetcher);
    await search(); await search();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("does not call WHO before authorizing the clinician", async () => {
    mocks.permission.mockRejectedValue(Object.assign(new Error("Permission denied"), { status: 403 }));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await search()).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  });
});
