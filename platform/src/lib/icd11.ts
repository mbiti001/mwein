export const DEFAULT_ICD11_RELEASE = "2026-01";

export function icd11Release(value = process.env.ICD11_RELEASE) {
  const release = value?.trim() || DEFAULT_ICD11_RELEASE;
  if (!/^\d{4}-\d{2}$/.test(release))
    throw new Error("ICD11_RELEASE must use the YYYY-MM format");
  return release;
}

export function normalizeWhoIcdUri(
  value: string | undefined,
  kind: "foundation" | "linearization",
) {
  if (!value) return undefined;
  const url = new URL(value);
  const prefix = kind === "foundation"
    ? "/icd/entity/"
    : "/icd/release/11/";
  if (url.hostname !== "id.who.int" || !url.pathname.startsWith(prefix) || url.search || url.hash)
    throw new Error(`Invalid WHO ICD-11 ${kind} URI`);
  return `http://id.who.int${url.pathname}`;
}

export function cleanWhoTitle(value: unknown) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
