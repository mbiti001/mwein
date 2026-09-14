import { afterEach, describe, expect, it } from "vitest";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, loginThrottleIdentity, nextLoginFailure } from "./login-security";

const originalSecret = process.env.AUTH_SECRET;
afterEach(() => { process.env.AUTH_SECRET = originalSecret; });

describe("login security", () => {
  it("normalizes tenant and email without storing either in the throttle key", () => {
    process.env.AUTH_SECRET = "test-secret-that-is-at-least-thirty-two-characters";
    const first = loginThrottleIdentity("mms", "Admin@Mwein.Local", "ip-hash");
    const second = loginThrottleIdentity(" MMS ", "admin@mwein.local", "ip-hash");
    expect(first).toEqual(second);
    expect(first.key).not.toContain("admin@mwein.local");
  });

  it("blocks at the configured failure threshold and resets after the window", () => {
    const started = new Date("2026-09-11T10:00:00.000Z");
    let state = nextLoginFailure(null, started);
    for (let index = 1; index < LOGIN_MAX_FAILURES; index += 1)
      state = nextLoginFailure(state, new Date(started.getTime() + index * 1000));
    expect(state.blockedUntil).not.toBeNull();
    const reset = nextLoginFailure(state, new Date(started.getTime() + LOGIN_WINDOW_MS + 1));
    expect(reset).toMatchObject({ failedCount: 1, blockedUntil: null });
  });
});
