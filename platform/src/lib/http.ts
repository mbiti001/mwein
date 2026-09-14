import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function apiError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: "Validation failed", reason: error.issues[0]?.message || "One or more entries are invalid", issues: error.issues }, { status: 422 });
  const value = error as { status?: number; message?: string; details?: unknown; code?: string };
  if (value.code === "P2002") return NextResponse.json({ error: "This record already exists", reason: "A unique value is already in use. Refresh and review the existing record before trying again." }, { status: 409 });
  if (value.code === "P2025") return NextResponse.json({ error: "The record could not be saved", reason: "It was changed or removed after this page was opened. Refresh and try again." }, { status: 409 });
  if (value.code === "P2003") return NextResponse.json({ error: "The record could not be saved", reason: "A linked patient, visit, order, or catalogue record is missing or no longer available." }, { status: 409 });
  const status = value.status || 500;
  if (status >= 500) console.error(JSON.stringify({ level: "error", event: "api_error", name: error instanceof Error ? error.name : "UnknownError", code: value.code }));
  const message = status >= 500 ? "The server could not complete this save" : value.message || "Request failed";
  const reason = status >= 500 ? "No data was confirmed as saved. Try again; if the problem continues, contact an administrator." : value.message;
  return NextResponse.json({ error: message, ...(reason ? { reason } : {}), ...(value.details ? { details: value.details } : {}) }, { status });
}
