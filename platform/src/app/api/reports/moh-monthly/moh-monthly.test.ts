vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    facilityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    facility: { code: "MMS", name: "Mwein Medical Services" },
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    visit: { findMany: vi.fn() },
    referral: { count: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { GET } from "./route";

const visitFindMany = db.visit.findMany as unknown as ReturnType<typeof vi.fn>;
const referralCount = db.referral.count as unknown as ReturnType<typeof vi.fn>;

describe("MOH monthly referral reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitFindMany.mockResolvedValue([]);
    referralCount.mockResolvedValue(3);
  });

  it("counts referral records by the date they were actually sent", async () => {
    const response = await GET(new Request("http://localhost/api/reports/moh-monthly?month=2026-09"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ services: { visits: 0, referrals: 3 } });
    expect(referralCount).toHaveBeenCalledWith({
      where: {
        facilityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        sentAt: {
          gte: new Date("2026-08-31T21:00:00.000Z"),
          lt: new Date("2026-09-30T21:00:00.000Z"),
        },
      },
    });
  });
});
