import type { Instrumentation } from "next";

export function register() {
  const deployment = process.env.VERCEL_GIT_COMMIT_SHA || process.env.DEPLOYMENT_VERSION || "local";
  console.info(JSON.stringify({ level: "info", event: "application_started", deployment, runtime: process.env.NEXT_RUNTIME }));
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  console.error(JSON.stringify({
    level: "error",
    event: "request_failed",
    errorName,
    digest,
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
  }));
};
