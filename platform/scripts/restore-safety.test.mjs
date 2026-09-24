import { describe, expect, it } from "vitest";
import { databaseIdentity, identityHash, validateRestorePlan, connectionEnvironment } from "./restore-safety.mjs";
const sourceUrl = "postgresql://source:password@ep-source.example:5432/main?sslmode=require";
const targetUrl = "postgresql://target:password@ep-disposable.example/drill?sslmode=require";
const backupHash = "a".repeat(64);
const approval = { disposable: true, approvedBy: "operator", reference: "DRILL-1", expiresAt: "2099-01-01", sourceIdentityHash: identityHash(sourceUrl), targetIdentityHash: identityHash(targetUrl), backupSha256: backupHash, sourceSystemIdentifier: "123", targetSystemIdentifier: "456" };
const plan = { sourceUrl, targetUrl, approval, backupHash, sourceSystem: "123", targetSystem: "456" };
describe("restore target safety", () => {
  it("accepts only the independently approved distinct system and exact backup", () => expect(() => validateRestorePlan(plan)).not.toThrow());
  it.each([
    {}, { sourceUrl: undefined }, { approval: undefined }, { backupHash: "b".repeat(64) },
    { targetSystem: "123" }, { targetSystem: "unknown" }, { sourceSystem: "999" },
    { approval: { ...approval, expiresAt: "2020-01-01" } }, { approval: { ...approval, disposable: false } },
    { targetUrl: "postgresql://other:credential@ep-source-pooler.example/main?sslmode=require" },
    { targetUrl: "postgres://other@ep-source.example:5432/%6dain?connect_timeout=10&sslmode=require" },
  ].slice(1))("rejects unsafe plan %j", change => expect(() => validateRestorePlan({ ...plan, ...change })).toThrow());
  it("rejects alternate libpq host redirection", () => expect(() => databaseIdentity(targetUrl + "&host=ep-source.example")).toThrow());
  it("normalizes pooler, default port and percent encoded database", () => expect(databaseIdentity("postgres://a@ep-source-pooler.example/%6dain")).toBe(databaseIdentity(sourceUrl)));
});

it("does not inherit libpq redirection or leak credentials into database arguments", () => {
  const env = connectionEnvironment("postgresql://operator:encoded%40password@disposable.example/drill?sslmode=require", { PATH: "/bin", PGHOSTADDR: "production", PGSERVICE: "production", PGOPTIONS: "redirect", PGDATABASE: "production" });
  expect(env).toMatchObject({ PGHOST: "disposable.example", PGDATABASE: "drill", PGUSER: "operator", PGPASSWORD: "encoded@password", PGSSLMODE: "require" });
  expect(env).not.toHaveProperty("PGHOSTADDR"); expect(env).not.toHaveProperty("PGSERVICE"); expect(env).not.toHaveProperty("PGOPTIONS");
});
