import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const migration = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1
    `;
    return NextResponse.json({ status: "ok", database: "connected", migration: migration[0]?.migration_name ?? "none", time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
