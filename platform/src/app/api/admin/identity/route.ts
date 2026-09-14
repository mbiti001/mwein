import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { externalIdentityConfiguration, normalizeProviderGroup } from "@/lib/external-identity";
import { apiError } from "@/lib/http";

const schema = z.object({
  providerGroup: z.string().trim().min(2).max(160),
  roleCode: z.string().trim().min(2).max(80).refine((value) => value !== "SYSTEM_ADMIN", "External groups cannot grant system-administrator access"),
  active: z.boolean(),
});

export async function GET() {
  try {
    const user = await requirePermission("admin.users");
    const [mappings, roles, linkedIdentities] = await Promise.all([
      db.identityRoleMapping.findMany({ where: { facilityId: user.facilityId }, orderBy: [{ providerGroup: "asc" }, { roleCode: "asc" }] }),
      db.role.findMany({ where: { code: { not: "SYSTEM_ADMIN" } }, select: { code: true, name: true }, orderBy: { name: "asc" } }),
      db.externalIdentity.count({ where: { facilityId: user.facilityId } }),
    ]);
    return NextResponse.json({ configuration: externalIdentityConfiguration(), mappings, roles, linkedIdentities });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.users");
    const input = schema.parse(await request.json());
    const role = await db.role.findUnique({ where: { code: input.roleCode }, select: { code: true } });
    if (!role || role.code === "SYSTEM_ADMIN") throw Object.assign(new Error("Select an operational role"), { status: 422 });
    const providerGroup = normalizeProviderGroup(input.providerGroup);
    const mapping = await db.$transaction(async (tx) => {
      const saved = await tx.identityRoleMapping.upsert({
        where: { facilityId_providerGroup_roleCode: { facilityId: user.facilityId, providerGroup, roleCode: role.code } },
        update: { active: input.active, updatedById: user.id },
        create: { facilityId: user.facilityId, providerGroup, roleCode: role.code, active: input.active, updatedById: user.id },
      });
      await appendAudit(tx, { userId: user.id, action: "IDENTITY_ROLE_MAPPING_UPDATED", entityType: "IdentityRoleMapping", entityId: saved.id, afterHash: `${providerGroup}:${role.code}:${input.active}` });
      return saved;
    });
    return NextResponse.json({ mapping });
  } catch (error) { return apiError(error); }
}
