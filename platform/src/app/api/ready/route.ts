import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { governanceReadiness, productionConfigurationReadiness } from "@/lib/governance";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const facilities = await db.facility.findMany({
      select: { code: true, governanceEvidence: true },
      orderBy: { code: "asc" },
    });
    const configuration = productionConfigurationReadiness();
    const governance = facilities.map((facility) => ({ code: facility.code, ...governanceReadiness(facility.governanceEvidence) }));
    const ready = facilities.length > 0 && configuration.ready && governance.every((facility) => facility.ready);
    return NextResponse.json({
      status: ready ? "ready" : "blocked",
      configuration: configuration.checks,
      facilities: governance.map((facility) => ({
        code: facility.code,
        ready: facility.ready,
        approved: facility.approved,
        total: facility.total,
        missing: facility.gates.filter((gate) => !gate.ready).map((gate) => gate.code),
      })),
    }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "blocked", database: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
