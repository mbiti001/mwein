import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(body, { ...init, headers });
}

export function apiError(error: unknown) {
  if (error instanceof ZodError) return privateJson({ error: "Validation failed", reason: error.issues[0]?.message || "One or more entries are invalid", issues: error.issues }, { status: 422 });
  const value = error as { status?: number; message?: string; details?: unknown; code?: string };
  if (value.code === "P2002") return privateJson({ error: "This record already exists", reason: "A unique value is already in use. Refresh and review the existing record before trying again." }, { status: 409 });
  if (value.code === "P2025") return privateJson({ error: "The record could not be saved", reason: "It was changed or removed after this page was opened. Refresh and try again." }, { status: 409 });
  if (value.code === "P2034") return privateJson({ error: "The record changed while it was being saved", reason: "Refresh and try again. No partial change was committed." }, { status: 409 });
  if (value.code === "P2003") return privateJson({ error: "The record could not be saved", reason: "A linked patient, visit, order, or catalogue record is missing or no longer available." }, { status: 409 });
  const status = value.status || 500;
  if (status >= 500) console.error(JSON.stringify({ level: "error", event: "api_error", name: error instanceof Error ? error.name : "UnknownError", code: value.code }));
  const message = status >= 500 ? "The server could not complete this save" : value.message || "Request failed";
  const reason = status >= 500 ? "No data was confirmed as saved. Try again; if the problem continues, contact an administrator." : value.message;
  return privateJson({ error: message, ...(reason ? { reason } : {}), ...(value.details ? { details: value.details } : {}) }, { status });
}
