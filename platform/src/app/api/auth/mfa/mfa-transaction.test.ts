import { beforeEach, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(), SESSION_COOKIE: "__Host-mwein_hmis_session" }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/security", () => ({ hashToken: vi.fn(() => "synthetic-token-hash"), newSessionToken: vi.fn(() => "synthetic-token"), verifyPassword: vi.fn() }));
vi.mock("@/lib/mfa", () => ({
  MFA_CHALLENGE_MS: 600_000, acceptedMfaStep: vi.fn(), newMfaSecret: vi.fn(), newRecoveryCodes: vi.fn(),
  encryptMfaSecret: vi.fn((secret: string) => `cipher:${secret}`), decryptMfaSecret: vi.fn((cipher: string) => cipher.replace("cipher:", "")),
  authenticator: vi.fn((secret: string) => ({ toString: () => `synthetic-setup:${secret}` })),
  recoveryHash: vi.fn((_actor: string, code: string) => `hash:${code}`),
  mfaFailure: vi.fn((mfa: { failedAttempts: number }, now: Date) => ({ failedAttempts: mfa.failedAttempts + 1, attemptWindowAt: now, blockedUntil: mfa.failedAttempts >= 4 ? new Date(now.getTime() + 900_000) : null })),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn() } }));

import { cookies } from "next/headers";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { newSessionToken, verifyPassword } from "@/lib/security";
import { acceptedMfaStep, newMfaSecret, newRecoveryCodes } from "@/lib/mfa";
import { POST } from "./route";

const actor = { id: "synthetic-user", sessionId: "password-session", facilityId: "synthetic-facility", email: "mfa@example.test", facility: { code: "TEST" } };
const conflict = () => Object.assign(new Error("synthetic aborted audit transaction"), { code: "P2010", meta: { code: "40001" } });
const cookieSet = vi.fn();
let committed: any;
let pending: any;
let committedAudits: any[];
let pendingAudits: any[];
let tx: any;
const send = (action: string, extra: object = {}) => POST(new Request("http://localhost/api/auth/mfa", { method: "POST", body: JSON.stringify({ action, password: "synthetic-password", code: "synthetic-code", ...extra }) }));

beforeEach(() => {
  vi.resetAllMocks();
  committed = {
    session: { id: actor.sessionId, userId: actor.id, user: { status: "ACTIVE", mustChangePassword: false, passwordHash: "synthetic-password-hash" }, createdAt: new Date(), expiresAt: new Date(Date.now() + 600_000), mfaVerifiedAt: null, ipHash: "synthetic-ip", userAgent: "synthetic-agent" },
    mfa: { userId: actor.id, enabledAt: null, secretCiphertext: null, pendingCiphertext: null, pendingSessionId: null, pendingExpiresAt: null, lastUsedStep: null, recoveryHashes: [], failedAttempts: 0, blockedUntil: null, recoveryRequired: false },
    newSessions: [],
  };
  committedAudits = [];
  vi.mocked(currentUser).mockResolvedValue(actor as any);
  vi.mocked(cookies).mockResolvedValue({ set: cookieSet } as any);
  vi.mocked(verifyPassword).mockReturnValue(true);
  vi.mocked(acceptedMfaStep).mockReturnValue(10);
  vi.mocked(newSessionToken).mockReturnValue("synthetic-token");
  vi.mocked(newMfaSecret).mockImplementation(() => `synthetic-secret-${vi.mocked(newMfaSecret).mock.calls.length}`);
  vi.mocked(newRecoveryCodes).mockImplementation(() => {
    const code = `synthetic-new-recovery-${vi.mocked(newRecoveryCodes).mock.calls.length}`;
    return { codes: [code], hashes: [`hash:${code}`] };
  });
  vi.mocked(QRCode.toDataURL).mockResolvedValue("data:image/png;base64,synthetic" as never);
  tx = {
    session: {
      findUnique: vi.fn(async () => pending.session),
      deleteMany: vi.fn(async () => { pending.session = null; }),
      create: vi.fn(async ({ data }: any) => { const row = { id: `verified-${vi.mocked(db.$transaction).mock.calls.length}`, ...data }; pending.newSessions.push(row); return row; }),
    },
    userMfa: {
      upsert: vi.fn(async () => structuredClone(pending.mfa)),
      update: vi.fn(async ({ data }: any) => { Object.assign(pending.mfa, data); return pending.mfa; }),
    },
  };
  vi.mocked(appendAudit).mockImplementation(async (_tx, event) => { pendingAudits.push(event); return { id: "synthetic-audit" } as any; });
  // A commit/abort model verifies route retry boundaries, not native SQL rollback.
  vi.mocked(db.$transaction).mockImplementation(async (work: any) => {
    pending = structuredClone(committed); pendingAudits = [];
    const result = await work(tx);
    committed = pending; committedAudits.push(...pendingAudits);
    return result;
  });
});

function pendingEnrollment() {
  Object.assign(committed.mfa, { pendingCiphertext: "cipher:synthetic-pending", pendingSessionId: actor.sessionId, pendingExpiresAt: new Date(Date.now() + 600_000), recoveryRequired: true });
}
function enrolled() {
  Object.assign(committed.mfa, { enabledAt: new Date(), secretCiphertext: "cipher:synthetic-existing", recoveryHashes: ["hash:synthetic-recovery", "hash:other-code"] });
}

it("retries START after raw audit serialization and exposes only committed setup", async () => {
  vi.mocked(appendAudit).mockRejectedValueOnce(conflict());
  vi.mocked(QRCode.toDataURL).mockImplementation(async () => { expect(committedAudits).toHaveLength(1); return "synthetic-qr"; });
  const response = await send("START");
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(tx.session.findUnique).toHaveBeenCalledTimes(2);
  expect(committed.mfa.pendingCiphertext).toBe(`cipher:${result.secret}`);
  expect(committed.mfa.pendingSessionId).toBe(actor.sessionId);
  expect(committed.mfa.enabledAt).toBeNull();
  expect(committedAudits[0]).toMatchObject({ action: "MFA_ENROLLMENT_STARTED", userId: actor.id, facilityId: actor.facilityId, sessionId: actor.sessionId });
  expect(QRCode.toDataURL).toHaveBeenCalledTimes(1);
  expect(cookieSet).not.toHaveBeenCalled();
  expect(tx.session.create).not.toHaveBeenCalled();
});

it.each(["CONFIRM", "VERIFY", "RECOVERY_CODES"])("retries %s atomically before one session cookie", async action => {
  if (action === "CONFIRM") pendingEnrollment(); else enrolled();
  vi.mocked(appendAudit).mockRejectedValueOnce(conflict());
  cookieSet.mockImplementation(() => { expect(committed.newSessions).toHaveLength(1); expect(committedAudits).toHaveLength(1); });
  const response = await send(action);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(tx.session.findUnique).toHaveBeenCalledTimes(2);
  expect(committed.newSessions).toHaveLength(1); expect(committedAudits).toHaveLength(1);
  expect(committedAudits[0].sessionId).toBe(committed.newSessions[0].id);
  expect(committed.mfa.lastUsedStep).toBe(10);
  expect(tx.session.deleteMany).toHaveBeenLastCalledWith({ where: { userId: actor.id, ...(action === "VERIFY" ? { id: actor.sessionId } : {}) } });
  if (action !== "VERIFY") expect(result.recoveryCodes.map((code: string) => `hash:${code}`)).toEqual(committed.mfa.recoveryHashes);
  if (action === "CONFIRM") expect(committed.mfa).toMatchObject({ recoveryRequired: false, pendingCiphertext: null, pendingSessionId: null });
  expect(newSessionToken).toHaveBeenCalledTimes(1);
  expect(cookieSet).toHaveBeenCalledTimes(1);
  expect(cookieSet).toHaveBeenCalledWith("__Host-mwein_hmis_session", "synthetic-token", expect.objectContaining({ httpOnly: true, secure: true, sameSite: "strict", path: "/" }));
});

it("retries protected replacement with only its committed pending secret exposed", async () => {
  enrolled(); vi.mocked(appendAudit).mockRejectedValueOnce(conflict());
  const response = await send("REPLACE");
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(committed.mfa.pendingCiphertext).toBe(`cipher:${result.secret}`);
  expect(committed.mfa.secretCiphertext).toBe("cipher:synthetic-existing");
  expect(committed.mfa.lastUsedStep).toBe(10);
  expect(committedAudits).toHaveLength(1);
  expect(committedAudits[0]).toMatchObject({ action: "MFA_ENROLLMENT_STARTED", reason: "REPLACE" });
  expect(cookieSet).not.toHaveBeenCalled(); expect(tx.session.create).not.toHaveBeenCalled();
});

it("consumes a recovery code once and revokes other sessions only in the winning transaction", async () => {
  enrolled(); vi.mocked(acceptedMfaStep).mockReturnValue(null);
  vi.mocked(appendAudit).mockRejectedValueOnce(conflict());
  expect((await send("VERIFY", { code: "synthetic-recovery" })).status).toBe(200);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(committed.mfa.recoveryHashes).toEqual(["hash:other-code"]);
  expect(committed.newSessions).toHaveLength(1); expect(committedAudits).toHaveLength(1);
  expect(committedAudits[0]).toMatchObject({ action: "MFA_VERIFIED", reason: "RECOVERY_CODE" });
  expect(tx.session.deleteMany).toHaveBeenLastCalledWith({ where: { userId: actor.id } });
  expect(cookieSet).toHaveBeenCalledTimes(1);
});

it("retries a failed factor counter without double counting or granting a session", async () => {
  enrolled(); committed.mfa.failedAttempts = 4;
  vi.mocked(acceptedMfaStep).mockReturnValue(null);
  vi.mocked(appendAudit).mockRejectedValueOnce(conflict());
  const response = await send("VERIFY", { code: "not-a-recovery-code" });
  expect(response.status).toBe(429);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(committed.mfa.failedAttempts).toBe(5);
  expect(committed.mfa.blockedUntil).toBeInstanceOf(Date);
  expect(committedAudits).toHaveLength(1);
  expect(committedAudits[0].action).toBe("MFA_VERIFICATION_FAILED");
  expect(cookieSet).not.toHaveBeenCalled(); expect(tx.session.create).not.toHaveBeenCalled();
});

it("rereads revoked sessions after abort instead of replaying a consumed recovery code", async () => {
  enrolled(); vi.mocked(acceptedMfaStep).mockReturnValue(null);
  vi.mocked(appendAudit).mockImplementationOnce(async () => { committed.session = null; committed.mfa.recoveryHashes = ["hash:other-code"]; throw conflict(); });
  expect((await send("VERIFY", { code: "synthetic-recovery" })).status).toBe(401);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(tx.session.findUnique).toHaveBeenCalledTimes(2);
  expect(committed.newSessions).toEqual([]); expect(committedAudits).toEqual([]);
  expect(committed.mfa.recoveryHashes).toEqual(["hash:other-code"]);
  expect(cookieSet).not.toHaveBeenCalled();
});

it("exhausts exactly three aborted START attempts without returning setup", async () => {
  vi.mocked(appendAudit).mockRejectedValue(conflict());
  const response = await send("START");
  expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("secret");
  expect(db.$transaction).toHaveBeenCalledTimes(3);
  expect(committed.mfa.pendingCiphertext).toBeNull(); expect(committedAudits).toEqual([]);
  expect(QRCode.toDataURL).not.toHaveBeenCalled(); expect(cookieSet).not.toHaveBeenCalled();
});

it.each([new Error("synthetic audit unavailable"), Object.assign(new Error("ambiguous transport failure"), { code: "ECONNRESET" })])("does not retry non-aborted failures", async error => {
  vi.mocked(appendAudit).mockRejectedValue(error);
  expect((await send("START")).status).toBe(500);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(committed.mfa.pendingCiphertext).toBeNull(); expect(cookieSet).not.toHaveBeenCalled();
});

it("does not replay committed enrollment when QR generation fails", async () => {
  vi.mocked(QRCode.toDataURL).mockRejectedValue(conflict());
  expect((await send("START")).status).toBe(409);
  expect(db.$transaction).toHaveBeenCalledTimes(1); expect(committedAudits).toHaveLength(1);
  expect(committed.mfa.pendingCiphertext).toBeTruthy(); expect(cookieSet).not.toHaveBeenCalled();
});

it.each(["P2002", "P2003"])("does not retry an integrity conflict: %s", async code => {
  vi.mocked(appendAudit).mockRejectedValue({ code });
  expect((await send("START")).status).toBe(409);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(committed.mfa.pendingCiphertext).toBeNull(); expect(committedAudits).toEqual([]);
  expect(QRCode.toDataURL).not.toHaveBeenCalled(); expect(cookieSet).not.toHaveBeenCalled();
});

it.each(["inactive", "expired", "old-challenge", "temporary-password", "blocked", "already-enrolled", "foreign-setup", "used-factor"])("retains the %s guard", async guard => {
  let action = "START"; let status = 401;
  if (guard === "inactive") committed.session.user.status = "SUSPENDED";
  if (guard === "expired") committed.session.expiresAt = new Date(0);
  if (guard === "old-challenge") committed.session.createdAt = new Date(0);
  if (guard === "temporary-password") { committed.session.user.mustChangePassword = true; status = 403; }
  if (guard === "blocked") { committed.mfa.blockedUntil = new Date(Date.now() + 60_000); status = 429; }
  if (guard === "already-enrolled") { enrolled(); status = 409; }
  if (guard === "foreign-setup") { pendingEnrollment(); committed.mfa.pendingSessionId = "another-session"; action = "CONFIRM"; status = 409; }
  if (guard === "used-factor") { enrolled(); committed.mfa.recoveryHashes = []; vi.mocked(acceptedMfaStep).mockReturnValue(null); action = "VERIFY"; }
  expect((await send(action)).status).toBe(status);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(tx.session.create).not.toHaveBeenCalled(); expect(cookieSet).not.toHaveBeenCalled();
});
