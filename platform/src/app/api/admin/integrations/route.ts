import { auditedOperationalJson } from "@/lib/audited-json";
import { requirePermission } from "@/lib/auth";
import { integrationReadiness } from "@/lib/integrations";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    const user = await requirePermission("admin.dashboard");
    return await auditedOperationalJson(user, "admin/integrations", { integrations: integrationReadiness() });
  } catch (error) {
    return apiError(error);
  }
}
