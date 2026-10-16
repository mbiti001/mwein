import { beforeEach, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn(), loginThrottle: { findUnique: vi.fn(), deleteMany: vi.fn() }, facility: { findUnique: vi.fn() }, user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/security", () => ({ hashPassword: vi.fn(() => "dummy-hash"), hashToken: vi.fn(() => "synthetic-token-hash"), newSessionToken: vi.fn(() => "synthetic-token"), verifyPassword: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(), SESSION_COOKIE: "__Host-mwein_hmis_session" }));
vi.mock("@/lib/mfa", () => ({ workforceMfaRequired: vi.fn(), MFA_CHALLENGE_MS: 600_000 }));
vi.mock("@/lib/login-security", () => ({ LOGIN_BLOCK_MS: 900_000, loginThrottleIdentity: vi.fn(() => ({ key: "throttle-key", emailHash: "email-hash" })), requestIpHash: vi.fn(() => "ip-hash"), nextLoginFailure: vi.fn(() => ({ failedAttempts: 1, blockedUntil: null })) }));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { newSessionToken, verifyPassword } from "@/lib/security";
import { currentUser } from "@/lib/auth";
import { workforceMfaRequired } from "@/lib/mfa";
import { POST } from "./route";

const serialization = () => Object.assign(new Error("synthetic serialization failure"), { code: "P2010", meta: { code: "40001" } });
const actor = { id: "synthetic-user", facilityId: "synthetic-facility", status: "ACTIVE", passwordHash: "synthetic-password-hash", mfaCredential: null };
const cookieSet = vi.fn();
let tx: any;
let committedSessions: any[];
let committedAudits: any[];
let committedFailures: any[];
let pendingSessions: any[];
let pendingAudits: any[];
let pendingFailures: any[];
const send = () => POST(new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ facilityCode: "MMS", email: "synthetic@example.test", password: "synthetic-password" }) }));

beforeEach(() => {
  vi.resetAllMocks();
  committedSessions = []; committedAudits = []; committedFailures = [];
  vi.mocked(cookies).mockResolvedValue({ set: cookieSet } as any);
  vi.mocked(db.loginThrottle.findUnique).mockResolvedValue(null);
  vi.mocked(db.facility.findUnique).mockResolvedValue({ id: actor.facilityId } as any);
  vi.mocked(db.user.findUnique).mockResolvedValue(actor as any);
  vi.mocked(verifyPassword).mockReturnValue(true);
  vi.mocked(newSessionToken).mockReturnValue("synthetic-token");
  vi.mocked(workforceMfaRequired).mockReturnValue(false);
  vi.mocked(currentUser).mockResolvedValue({ id: actor.id, mfaRequired: false } as any);
  tx = {
    session: { create: vi.fn(async ({ data }: any) => { const row = { id: `session-attempt-${vi.mocked(db.$transaction).mock.calls.length}`, ...data }; pendingSessions.push(row); return row; }) },
    user: { update: vi.fn() },
    loginThrottle: { findUnique: vi.fn().mockResolvedValue(null), deleteMany: vi.fn(), upsert: vi.fn(async (args: any) => { pendingFailures.push(args); return { blockedUntil: null }; }) },
  };
  vi.mocked(appendAudit).mockImplementation(async (_tx, event) => { pendingAudits.push(event); return { id: "synthetic-audit" } as any; });
  // Model commit/abort to test the route's retry boundary. This is not SQL rollback evidence.
  vi.mocked(db.$transaction).mockImplementation(async (work: any) => {
    pendingSessions = []; pendingAudits = []; pendingFailures = [];
    const result = await work(tx);
    committedSessions.push(...pendingSessions); committedAudits.push(...pendingAudits); committedFailures.push(...pendingFailures);
    return result;
  });
});

it("retries the whole successful login after raw SQL serialization and sets one cookie only after commit", async () => {
  vi.mocked(appendAudit).mockRejectedValueOnce(serialization());
  cookieSet.mockImplementation(() => expect(committedSessions).toHaveLength(1));
  expect((await send()).status).toBe(200);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(tx.session.create).toHaveBeenCalledTimes(2);
  expect(tx.user.update).toHaveBeenCalledTimes(2);
  expect(committedSessions).toHaveLength(1); expect(committedAudits).toHaveLength(1);
  expect(committedAudits[0]).toMatchObject({ facilityId: actor.facilityId, userId: actor.id, sessionId: committedSessions[0].id, entityId: committedSessions[0].id, action: "LOGIN_SUCCEEDED" });
  expect(newSessionToken).toHaveBeenCalledTimes(1);
  expect(tx.loginThrottle.deleteMany).toHaveBeenCalledTimes(1);
  expect(db.loginThrottle.deleteMany).not.toHaveBeenCalled();
  expect(cookieSet).toHaveBeenCalledTimes(1);
  expect(cookieSet).toHaveBeenCalledWith("__Host-mwein_hmis_session", "synthetic-token", expect.objectContaining({ httpOnly: true, secure: true, sameSite: "strict", path: "/" }));
});

it("exhausts three serialization attempts without committing a session or setting a cookie", async () => {
  vi.mocked(appendAudit).mockRejectedValue(serialization());
  expect((await send()).status).toBe(409);
  expect(db.$transaction).toHaveBeenCalledTimes(3);
  expect(committedSessions).toEqual([]); expect(committedAudits).toEqual([]);
  expect(db.loginThrottle.deleteMany).not.toHaveBeenCalled(); expect(cookieSet).not.toHaveBeenCalled();
});

it.each([new Error("audit unavailable"), Object.assign(new Error("synthetic nonserialization SQL failure"), { code: "P2010", meta: { code: "P0001" } })])("does not retry a nonserialization audit failure", async error => {
  vi.mocked(appendAudit).mockRejectedValue(error);
  expect((await send()).status).toBe(500);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(committedSessions).toEqual([]); expect(cookieSet).not.toHaveBeenCalled();
});

it("includes throttle cleanup in the failed transaction without returning a cookie", async () => {
  tx.loginThrottle.deleteMany.mockRejectedValue(new Error("synthetic cleanup failure"));
  expect((await send()).status).toBe(500);
  expect(db.$transaction).toHaveBeenCalledTimes(1); expect(committedSessions).toEqual([]); expect(committedAudits).toEqual([]);
  expect(cookieSet).not.toHaveBeenCalled();
});

it("never retries the committed transaction when current-user response preparation fails", async () => {
  vi.mocked(currentUser).mockRejectedValue(new Error("synthetic post-commit read failure"));
  expect((await send()).status).toBe(500);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(committedSessions).toHaveLength(1); expect(committedAudits).toHaveLength(1);
  expect(cookieSet).toHaveBeenCalledTimes(1);
});

it("preserves the MFA challenge after a retried password verification", async () => {
  vi.mocked(workforceMfaRequired).mockReturnValue(true);
  vi.mocked(currentUser).mockResolvedValue({ id: actor.id, mfaRequired: true, permissions: [] } as any);
  vi.mocked(appendAudit).mockRejectedValueOnce(serialization());
  const start = Date.now(); const response = await send();
  expect(response.status).toBe(200); expect((await response.json()).user).toMatchObject({ mfaRequired: true, permissions: [] });
  expect(committedAudits[0].action).toBe("LOGIN_PASSWORD_VERIFIED");
  expect(committedSessions[0].expiresAt.getTime()).toBeGreaterThanOrEqual(start + 600_000);
  expect(committedSessions[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
  expect(cookieSet).toHaveBeenCalledTimes(1);
});

it("rejects a blocked account before password lookup, transaction or cookie", async () => {
  vi.mocked(db.loginThrottle.findUnique).mockResolvedValue({ blockedUntil: new Date(Date.now() + 60_000) } as any);
  const response = await send(); expect(response.status).toBe(429); expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(db.facility.findUnique).not.toHaveBeenCalled(); expect(verifyPassword).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled(); expect(cookieSet).not.toHaveBeenCalled();
});

it("does not bypass enrolled MFA when workforce-wide enforcement is off", async () => {
  vi.mocked(db.user.findUnique).mockResolvedValue({ ...actor, mfaCredential: { enabledAt: new Date(), recoveryRequired: false } } as any);
  vi.mocked(currentUser).mockResolvedValue({ id: actor.id, mfaRequired: true, permissions: [] } as any);
  expect((await send()).status).toBe(200);
  expect(committedAudits[0].action).toBe("LOGIN_PASSWORD_VERIFIED");
  expect(cookieSet).toHaveBeenCalledTimes(1);
});

it("denies an inactive account even with a matching password", async () => {
  vi.mocked(db.user.findUnique).mockResolvedValue({ ...actor, status: "SUSPENDED" } as any);
  expect((await send()).status).toBe(401);
  expect(committedAudits[0]).toMatchObject({ action: "LOGIN_FAILED", reason: "ACCOUNT_SUSPENDED" });
  expect(tx.session.create).not.toHaveBeenCalled(); expect(cookieSet).not.toHaveBeenCalled();
});

it("retries only the failed credential counter transaction and still denies login", async () => {
  vi.mocked(verifyPassword).mockReturnValue(false);
  tx.loginThrottle.upsert.mockRejectedValueOnce(serialization());
  expect((await send()).status).toBe(401);
  expect(tx.loginThrottle.upsert).toHaveBeenCalledTimes(2);
  expect(committedFailures).toHaveLength(1); expect(committedAudits[0].action).toBe("LOGIN_FAILED");
  expect(tx.session.create).not.toHaveBeenCalled(); expect(newSessionToken).not.toHaveBeenCalled(); expect(cookieSet).not.toHaveBeenCalled();
});
