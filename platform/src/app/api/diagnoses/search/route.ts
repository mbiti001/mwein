import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { db } from "@/lib/db";
import { createDiagnosisSelectionToken } from "@/lib/diagnosis-selection";
import { cleanWhoTitle, icd11Release, normalizeWhoIcdUri } from "@/lib/icd11";

type Result = {
  code: string;
  title: string;
  foundationUri?: string;
  linearizationUri?: string;
  codingVersion?: string;
  source: "WHO ICD-11" | "Facility history";
};

let tokenCache: { value: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string> | null = null;

async function accessToken(clientId: string, clientSecret: string) {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "icdapi_access", grant_type: "client_credentials" });
    const response = await fetch("https://icdaccessmanagement.who.int/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`WHO ICD-11 authentication failed (${response.status})`);
    const value = await response.json() as { access_token?: string; expires_in?: number };
    if (!value.access_token) throw new Error("WHO ICD-11 authentication returned no access token");
    tokenCache = { value: value.access_token, expiresAt: Date.now() + Math.max(60, Number(value.expires_in || 300) - 60) * 1000 };
    return tokenCache.value;
  })().finally(() => { tokenRequest = null; });
  return tokenRequest;
}

async function whoSearch(query: string, clientId: string, clientSecret: string): Promise<Result[]> {
  const release = icd11Release();
  const url = new URL(`https://id.who.int/icd/release/11/${release}/mms/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("useFlexisearch", "true");
  url.searchParams.set("flatResults", "true");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${await accessToken(clientId, clientSecret)}`,
      "API-Version": "v2",
      "Accept-Language": "en",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`WHO ICD-11 search failed (${response.status})`);
  const data = await response.json() as { destinationEntities?: Array<{ id?: string; linearizationUri?: string; theCode?: string; title?: string; foundationUri?: string }> };
  return (data.destinationEntities || [])
    .filter((item) => item.theCode && cleanWhoTitle(item.title))
    .slice(0, 12)
    .map((item) => ({
      code: item.theCode!.toUpperCase(),
      title: cleanWhoTitle(item.title),
      foundationUri: normalizeWhoIcdUri(item.foundationUri, "foundation"),
      linearizationUri: normalizeWhoIcdUri(item.id || item.linearizationUri, "linearization"),
      codingVersion: release,
      source: "WHO ICD-11",
    }));
}

async function facilityHistory(facilityId: string, query: string): Promise<Result[]> {
  const history = await db.diagnosis.findMany({
    where: {
      encounter: { visit: { facilityId } },
      codingSystem: "ICD-11 MMS",
      code: { not: null },
      OR: [{ description: { contains: query, mode: "insensitive" } }, { code: { contains: query, mode: "insensitive" } }],
    },
    select: { code: true, description: true, foundationUri: true, linearizationUri: true, codingVersion: true },
    distinct: ["code"],
    take: 12,
    orderBy: { description: "asc" },
  });
  return history.map((item) => ({
    code: item.code!,
    title: item.description,
    foundationUri: item.foundationUri || undefined,
    linearizationUri: item.linearizationUri || undefined,
    codingVersion: item.codingVersion || undefined,
    source: "Facility history",
  }));
}

function signed(results: Result[], facilityId: string) {
  return results.map((result) => ({ ...result, selectionToken: createDiagnosisSelectionToken({ ...result, facilityId }) }));
}

export async function GET(request: Request) {
  try {
    const user = await requirePermission("encounter.write");
    const query = z.string().trim().min(2).max(120).parse(new URL(request.url).searchParams.get("q"));
    const clientId = process.env.ICD11_CLIENT_ID?.trim();
    const clientSecret = process.env.ICD11_CLIENT_SECRET?.trim();
    if (clientId && clientSecret) {
      try {
        const results = await whoSearch(query, clientId, clientSecret);
        return NextResponse.json({ results: signed(results, user.facilityId), source: "WHO ICD-11", release: icd11Release() });
      } catch (error) {
        console.error(JSON.stringify({ level: "error", event: "icd11_search_failed", name: error instanceof Error ? error.name : "UnknownError" }));
        const results = await facilityHistory(user.facilityId, query);
        return NextResponse.json({ results: signed(results, user.facilityId), source: "Facility history", upstreamUnavailable: true });
      }
    }
    const results = await facilityHistory(user.facilityId, query);
    return NextResponse.json({ results: signed(results, user.facilityId), source: "Facility history", configurationRequired: true });
  } catch (error) {
    return apiError(error);
  }
}
