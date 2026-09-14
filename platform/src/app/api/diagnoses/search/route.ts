import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { db } from "@/lib/db";
import { createDiagnosisSelectionToken } from "@/lib/diagnosis-selection";

type Result = { code: string; title: string; foundationUri?: string; source: "WHO ICD-11" | "Facility history" };
let tokenCache: { value: string; expiresAt: number } | null = null;

function text(value: unknown) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
}

async function whoSearch(query: string): Promise<Result[]> {
  const clientId = process.env.ICD11_CLIENT_ID;
  const clientSecret = process.env.ICD11_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];
  if (!tokenCache || tokenCache.expiresAt < Date.now()) {
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "icdapi_access", grant_type: "client_credentials" });
    const response = await fetch("https://icdaccessmanagement.who.int/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
    if (!response.ok) throw new Error("WHO ICD-11 authentication failed");
    const value = await response.json() as { access_token: string; expires_in: number };
    tokenCache = { value: value.access_token, expiresAt: Date.now() + Math.max(60, value.expires_in - 60) * 1000 };
  }
  const release = process.env.ICD11_RELEASE || "2026-01";
  const url = new URL(`https://id.who.int/icd/release/11/${release}/mms/search`);
  url.searchParams.set("q", query); url.searchParams.set("useFlexisearch", "true"); url.searchParams.set("flatResults", "true");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${tokenCache.value}`, "API-Version": "v2", "Accept-Language": "en" }, cache: "no-store" });
  if (!response.ok) throw new Error("WHO ICD-11 search is temporarily unavailable");
  const data = await response.json() as { destinationEntities?: Array<{ theCode?: string; title?: string; foundationUri?: string }> };
  return (data.destinationEntities || []).filter(item => item.theCode).slice(0, 12).map(item => ({ code: item.theCode!, title: text(item.title), foundationUri: item.foundationUri, source: "WHO ICD-11" }));
}

export async function GET(request: Request) {
  try {
    const user = await requirePermission("encounter.write");
    const query = z.string().trim().min(2).max(120).parse(new URL(request.url).searchParams.get("q"));
    const official = await whoSearch(query);
    if (official.length) return NextResponse.json({ results: official.map((result) => ({
      ...result,
      selectionToken: createDiagnosisSelectionToken({ ...result, facilityId: user.facilityId }),
    })), source: "WHO ICD-11" });
    const history = await db.diagnosis.findMany({
      where: { encounter: { visit: { facilityId: user.facilityId } }, codingSystem: "ICD-11 MMS", code: { not: null }, OR: [{ description: { contains: query, mode: "insensitive" } }, { code: { contains: query, mode: "insensitive" } }] },
      select: { code: true, description: true, foundationUri: true }, distinct: ["code"], take: 12, orderBy: { description: "asc" },
    });
    return NextResponse.json({ results: history.map(item => {
      const result = { code: item.code!, title: item.description, foundationUri: item.foundationUri || undefined, source: "Facility history" as const };
      return { ...result, selectionToken: createDiagnosisSelectionToken({ ...result, facilityId: user.facilityId }) };
    }), source: "Facility history", configurationRequired: true });
  } catch (error) { return apiError(error); }
}
