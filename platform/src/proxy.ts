import { NextResponse, type NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV !== "production";
  const csp = `default-src 'self'; base-uri 'self'; connect-src 'self'${development ? " ws: wss:" : ""}; font-src 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}; style-src 'self' 'nonce-${nonce}';${development ? "" : " upgrade-insecure-requests;"}`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const next = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  if (SAFE_METHODS.has(request.method)) return next();
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
  return next();
}

export const config = { matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }] };
