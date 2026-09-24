import { recordDisclosure } from "@/lib/disclosure-audit";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { AUDIT_CHAIN_VERSION, verifyAuditChain } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requirePermission("audit.view");
    const [facility, head, legacyEvents, events] = await db.$transaction([
      db.facility.findUniqueOrThrow({ where: { id: user.facilityId }, select: { code: true, name: true } }),
      db.auditChainHead.findUnique({ where: { facilityId: user.facilityId } }),
      db.auditEvent.findMany({ where: { facilityId: user.facilityId, chainVersion: 1 }, orderBy: { occurredAt: "asc" } }),
      db.auditEvent.findMany({
        where: { facilityId: user.facilityId, chainVersion: AUDIT_CHAIN_VERSION },
        orderBy: { sequence: "asc" },
      }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const verification = verifyAuditChain(events.map((event) => ({ ...event, sequence: event.sequence! })), head?.eventHash);
    const generatedAt = new Date();
    const exportRecord = {
      schema: "mwein.audit-export.v1",
      facility,
      generatedAt: generatedAt.toISOString(),
      legacyEventCount: legacyEvents.length,
      legacyEvents: legacyEvents.map((event) => ({ ...event, sequence: null })),
      chain: {
        version: AUDIT_CHAIN_VERSION,
        expectedSequence: String(head?.sequence || 0),
        expectedHeadHash: head?.eventHash || "GENESIS",
        ...verification,
      },
      events: events.map((event) => ({ ...event, sequence: String(event.sequence) })),
    };
    const body = JSON.stringify(exportRecord, null, 2);
    const digest = createHash("sha256").update(body).digest("hex");
    const stamp = generatedAt.toISOString().replaceAll(":", "-").replace(".000Z", "Z");
    await recordDisclosure(user, "AUDIT_EXPORT", [], { digest, sequence: exportRecord.chain.expectedSequence });
    return new NextResponse(body, {
      status: verification.valid ? 200 : 409,
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${facility.code}-audit-${stamp}.json"`,
        "content-type": "application/json; charset=utf-8",
        "x-audit-export-sha256": digest,
      },
    });
  } catch (error) { return apiError(error); }
}
