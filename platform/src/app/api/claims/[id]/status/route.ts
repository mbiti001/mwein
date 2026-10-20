import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { canTransitionClaim, type ClaimStatus } from "@/lib/billing";
const schema = z.object({
  status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "PAID", "CANCELLED"]),
  notes: z.string().trim().min(2).max(1000),
});
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("claims.write");
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const claim = await db.$transaction(async (tx) => {
      // Re-read the claim and its parent here: a cancellation may have committed
      // since the operator opened the claims screen.
      const existing = await tx.claim.findFirst({
        where: { id, invoice: { visit: { facilityId: user.facilityId } } },
        include: { invoice: { select: { status: true, visit: { select: { status: true } } } } },
      });
      if (!existing)
        throw Object.assign(new Error("Claim not found"), { status: 404 });
      if (existing.payer === "SHA" && input.status !== "CANCELLED")
        throw Object.assign(new Error("SHA claim status must come from an authenticated SHA ClaimResponse; it cannot be changed manually"), { status: 403 });
      if (input.status !== "CANCELLED" && (existing.invoice.status === "VOID" || existing.invoice.visit.status === "CANCELLED"))
        throw Object.assign(new Error("A claim on a void invoice or cancelled visit cannot be progressed"), { status: 409 });
      if (!canTransitionClaim(existing.status as ClaimStatus, input.status))
        throw Object.assign(
          new Error(`Claim cannot move from ${existing.status} to ${input.status}`),
          { status: 409 },
        );
      const updated = await tx.claim.update({
        where: { id },
        data: {
          status: input.status,
          notes: [existing.notes, input.notes].filter(Boolean).join("\n"),
          submittedAt:
            input.status === "SUBMITTED"
              ? existing.submittedAt || new Date()
              : existing.submittedAt,
        },
      });
      await appendAudit(tx, {
        userId: user.id,
        action: `CLAIM_${input.status}`,
        entityType: "Claim",
        entityId: id,
        beforeHash: existing.status,
        afterHash: input.status,
        reason: input.notes,
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ claim });
  } catch (e) {
    return apiError(e);
  }
}
