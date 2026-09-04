type ApiIssue = { path?: Array<string | number>; message?: string };
type ApiFailure = { error?: string; reason?: string; issues?: ApiIssue[]; details?: unknown };

function fieldName(path?: Array<string | number>) {
  if (!path?.length) return "Request";
  return path
    .filter((part) => typeof part === "string" && !["data", "prescriptions"].includes(part))
    .map((part) => String(part).replace(/([a-z])([A-Z])/g, "$1 $2"))
    .join(" → ") || "Entry";
}

export function apiFailureMessage(payload: unknown, fallback: string) {
  const failure = (payload && typeof payload === "object" ? payload : {}) as ApiFailure;
  if (failure.issues?.length) {
    const reasons = failure.issues.slice(0, 3).map((issue) => `${fieldName(issue.path)}: ${issue.message || "invalid value"}`);
    return `${failure.error || "Validation failed"}. ${reasons.join("; ")}`;
  }
  if (failure.error && failure.reason && failure.reason !== failure.error) return `${failure.error}. ${failure.reason}`;
  return failure.error || failure.reason || fallback;
}

export class ApiRequestError extends Error {
  details?: unknown;
  status: number;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
  }
}

export async function jsonRequest<T>(url: string, options?: RequestInit, fallback = "The request could not be completed"): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(options?.headers);
    if (!(options?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiRequestError("Could not reach the server. Check your connection and try again.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(apiFailureMessage(data, fallback), response.status, (data as ApiFailure).details);
  }
  return data as T;
}
