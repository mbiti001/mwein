export function staffChangeIsSafe(input: {
  targetUserId: string;
  actingUserId: string;
  targetIsAdmin: boolean;
  activeAdminCount: number;
  nextStatus?: "ACTIVE" | "DISABLED";
  nextRoleCodes?: string[];
}) {
  if (input.targetUserId === input.actingUserId && input.nextStatus === "DISABLED")
    return { safe: false, reason: "You cannot disable your own account" };
  const removesAdmin = input.targetIsAdmin && input.nextRoleCodes && !input.nextRoleCodes.includes("SYSTEM_ADMIN");
  const disablesAdmin = input.targetIsAdmin && input.nextStatus === "DISABLED";
  if ((removesAdmin || disablesAdmin) && input.activeAdminCount <= 1)
    return { safe: false, reason: "At least one active system administrator is required" };
  return { safe: true };
}
