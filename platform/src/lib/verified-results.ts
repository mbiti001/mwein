// Clinical readers receive released reports. Department workbenches may separately
// read drafts under their laboratory/imaging write permission.
export const verifiedResultWhere = { status: "VERIFIED", verifiedAt: { not: null } } as const;

export function isVerifiedResult<T extends { status: string; verifiedAt?: string | Date | null }>(result: T | null | undefined): result is T & { verifiedAt: string | Date } {
  return result?.status === "VERIFIED" && Boolean(result.verifiedAt) && Number.isFinite(new Date(result.verifiedAt!).getTime());
}
