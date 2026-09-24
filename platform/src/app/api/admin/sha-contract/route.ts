import { auditedOperationalJson } from "@/lib/audited-json";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { SHA_DRAFT_CONTRACT, shaContractProfileReadiness, shaGatewayReadiness } from "@/lib/sha";

const optionalText = z.string().trim().max(500).optional();
const schema = z.object({
  status: z.enum(["DRAFT", "PREPARING", "EXECUTED"]),
  contractReference: optionalText,
  facilityFid: optionalText,
  regulatorRegistration: optionalText,
  countyOffice: optionalText,
  effectiveDate: z.iso.date().optional(),
  facilityTier: optionalText,
  enabledFunds: z.array(z.enum(["PHF", "SHIF", "ECCIF", "POMSF"])).max(4),
  tariffScheduleVersion: optionalText,
  pomsfAccessMatrixVersion: optionalText,
  notes: z.string().trim().max(3000).optional(),
}).superRefine((value, context) => {
  if (value.status !== "EXECUTED") return;
  const required: [keyof typeof value, string][] = [
    ["contractReference", "Executed status requires the signed contract reference"],
    ["facilityFid", "Executed status requires the SHA facility FID"],
    ["regulatorRegistration", "Executed status requires the regulator registration number"],
    ["countyOffice", "Executed status requires the SHA county office"],
    ["effectiveDate", "Executed status requires the effective date"],
    ["facilityTier", "Executed status requires the confirmed facility tier"],
    ["tariffScheduleVersion", "Executed status requires the signed tariff schedule version"],
  ];
  for (const [path, message] of required) {
    if (!value[path]) context.addIssue({ code: "custom", path: [path], message });
  }
  if (!value.enabledFunds.length) context.addIssue({ code: "custom", path: ["enabledFunds"], message: "Select at least one fund enabled by the executed contract" });
  if (value.enabledFunds.includes("POMSF") && !value.pomsfAccessMatrixVersion) {
    context.addIssue({ code: "custom", path: ["pomsfAccessMatrixVersion"], message: "POMSF activation requires the facility-specific access matrix version" });
  }
});

export async function GET() {
  try {
    const user = await requirePermission("admin.dashboard");
    const profile = await db.shaContractProfile.findUnique({
      where: { facilityId: user.facilityId },
      include: { updatedBy: { select: { displayName: true } } },
    });
    return await auditedOperationalJson(user, "admin/sha-contract", {
      profile,
      readiness: shaContractProfileReadiness(profile),
      gateway: shaGatewayReadiness(profile),
      draftSpecification: SHA_DRAFT_CONTRACT,
    });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requirePermission("admin.assign_governance");
    const input = schema.parse(await request.json());
    const previous = await db.shaContractProfile.findUnique({ where: { facilityId: user.facilityId } });
    const profile = await db.$transaction(async (tx) => {
      const record = await tx.shaContractProfile.upsert({
        where: { facilityId: user.facilityId },
        update: {
          ...input,
          effectiveDate: input.effectiveDate ? new Date(`${input.effectiveDate}T00:00:00.000Z`) : null,
          draftVersion: SHA_DRAFT_CONTRACT.version,
          updatedById: user.id,
        },
        create: {
          facilityId: user.facilityId,
          ...input,
          effectiveDate: input.effectiveDate ? new Date(`${input.effectiveDate}T00:00:00.000Z`) : null,
          draftVersion: SHA_DRAFT_CONTRACT.version,
          updatedById: user.id,
        },
        include: { updatedBy: { select: { displayName: true } } },
      });
      await appendAudit(tx, {
        facilityId: user.facilityId,
        userId: user.id,
        sessionId: user.sessionId,
        action: "SHA_CONTRACT_PROFILE_UPDATED",
        entityType: "ShaContractProfile",
        entityId: record.id,
        reason: input.notes,
        beforeHash: previous ? `${previous.status}:${previous.contractReference || "NO_REFERENCE"}:${previous.enabledFunds.join(",")}` : "UNRECORDED",
        afterHash: `${record.status}:${record.contractReference || "NO_REFERENCE"}:${record.enabledFunds.join(",")}:${record.draftVersion}`,
      });
      return record;
    });
    return NextResponse.json({ profile, readiness: shaContractProfileReadiness(profile) });
  } catch (error) { return apiError(error); }
}
