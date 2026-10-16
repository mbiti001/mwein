import { describe, expect, it } from "vitest";
import { z } from "zod";
import { apiError } from "./http";

describe("API error responses", () => {
  it.each(["40001", "40P01"])("reports an exhausted raw transaction conflict %s without SQL details", async code => {
    const response = apiError({ code: "P2010", meta: { code, message: "private SQL statement" } });
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({ error: "The record changed while it was being saved", reason: "Refresh and review the current record before trying again." });
    expect(JSON.stringify(body)).not.toContain("private SQL");
  });
  it("returns the actual validation reason and field issues", async () => {
    const failure = z.object({ quantity: z.number().positive() }).safeParse({ quantity: 0 });
    if (failure.success) throw new Error("Expected invalid test input");
    const response = apiError(failure.error);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "Validation failed", reason: "Too small: expected number to be >0" });
  });

  it("does not expose unexpected internal server messages", async () => {
    const response = apiError(new Error("database connection secret"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
