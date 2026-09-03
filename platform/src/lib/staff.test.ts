import { describe, expect, it } from "vitest";
import { staffChangeIsSafe } from "./staff";

describe("staff administration safeguards", () => {
  it("blocks self-disable", () => {
    expect(staffChangeIsSafe({ targetUserId: "1", actingUserId: "1", targetIsAdmin: true, activeAdminCount: 2, nextStatus: "DISABLED" }).safe).toBe(false);
  });

  it("protects the final active administrator", () => {
    expect(staffChangeIsSafe({ targetUserId: "2", actingUserId: "1", targetIsAdmin: true, activeAdminCount: 1, nextRoleCode: "CLINICIAN" }).safe).toBe(false);
  });

  it("allows ordinary role and status changes", () => {
    expect(staffChangeIsSafe({ targetUserId: "2", actingUserId: "1", targetIsAdmin: false, activeAdminCount: 1, nextRoleCode: "NURSE" }).safe).toBe(true);
  });
});
