import { NextResponse, type NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return NextResponse.next();
  const configuredOrigin = process.env.APP_ORIGIN?.trim();
  if (process.env.NODE_ENV === "production" && !configuredOrigin)
    return NextResponse.json({ error: "Application origin is not configured" }, { status: 503 });

  let expected: string;
  try { expected = new URL(configuredOrigin || request.nextUrl.origin).origin; }
  catch { return NextResponse.json({ error: "Application origin is not valid" }, { status: 503 }); }
  const supplied = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  let suppliedOrigin = "";
  try { suppliedOrigin = supplied ? new URL(supplied).origin : ""; } catch { suppliedOrigin = ""; }
  if (!suppliedOrigin || suppliedOrigin !== expected || (fetchSite && !["same-origin", "none"].includes(fetchSite)))
    return NextResponse.json({ error: "Request origin was not accepted" }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
