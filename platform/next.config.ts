import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.DEPLOYMENT_VERSION,
  async headers() {
    const securityHeaders = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    if (process.env.NODE_ENV === "production")
      securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
