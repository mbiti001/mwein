import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function apiError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: "Validation failed", issues: error.issues }, { status: 422 });
  const value = error as { status?: number; message?: string; details?: unknown };
  return NextResponse.json({ error: value.message || "Request failed", ...(value.details ? { details: value.details } : {}) }, { status: value.status || 500 });
}
