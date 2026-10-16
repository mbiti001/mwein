import { test } from "vitest";
import assert from "node:assert/strict";
import { createE2eDatabase, nativeDatabaseConfiguration } from "./e2e-database.mjs";

const url = "postgresql://fixture:synthetic-secret@127.0.0.1:5432/mwein_e2e_workflow";
function fake({ database = "mwein_e2e_workflow", inventory = { custom_schemas: 0, relations: 0, functions: 0, types: 0 }, failConnect, failQuery, failClose } = {}) {
  const calls = [], listeners = new Map(); let connects = 0, ends = 0;
  const client = {
    on: (event, callback) => listeners.set(event, callback),
    connect: async () => { connects++; if (failConnect) throw failConnect; },
    query: async (sql, values) => { calls.push({ sql, values }); if (failQuery) throw failQuery; return { rows: calls.length === 1 ? [{ database }] : calls.length === 2 ? [inventory] : [{ confirmed: true }] }; },
    end: async () => { ends++; if (failClose) throw failClose; },
  };
  return { client, calls, listeners, connects: () => connects, ends: () => ends };
}
for (const raw of ["", " ", "garbage", null, "https://localhost:5432/mwein_e2e_test", "postgres://fixture:secret@remote.example:5432/mwein_e2e_test", "postgres://fixture:secret@127.0.0.2:5432/mwein_e2e_test", "postgres://fixture:secret@127.1:5432/mwein_e2e_test", "postgres://fixture:secret@localhost/mwein_e2e_test", "postgres://fixture:secret@localhost:0/mwein_e2e_test", "postgres://fixture:secret@localhost:65536/mwein_e2e_test", "postgres://fixture:secret@localhost:5432/postgres", "postgres://fixture:secret@localhost:5432/mwein_e2e_", "postgres://fixture:secret@localhost:5432/mwein_e2e_TEST", `${url}?host=remote`, `${url}?schema=other`, `${url}?options=-csearch_path=other`, `${url}?`, `${url}#anything`, `${url}#`, url.replace("mwein_e2e_workflow", "mwein_e2e_%77orkflow"), "postgres://localhost:5432/mwein_e2e_test"]) {
  test(`reject unsafe native URL variant ${JSON.stringify(raw).replace(/synthetic-secret/g, "redacted")}`, async () => {
    let clientCreated = false, fallback = false;
    await assert.rejects(createE2eDatabase({ nativeDatabaseUrl: raw }, { createNativeClient: () => { clientCreated = true; }, createPGlite: () => { fallback = true; } }), /E2E native database URL/);
    assert.equal(clientCreated, false); assert.equal(fallback, false);
  });
}
for (const host of ["127.0.0.1", "localhost", "[::1]"]) test(`accept explicit dedicated fixture on ${host}`, () => {
  const config = nativeDatabaseConfiguration(url.replace("127.0.0.1", host));
  assert.equal(config.database, "mwein_e2e_workflow");
  const parsed = new URL(config.applicationDatabaseUrl);
  assert.deepEqual([...parsed.searchParams], [["sslmode", "disable"], ["connection_limit", "5"]]);
  assert.equal(parsed.searchParams.has("pgbouncer"), false);
});
test("native setup checks identity and all user objects before exposing any write-capable adapter", async () => {
  const f = fake(); let options;
  const backend = await createE2eDatabase({ nativeDatabaseUrl: url }, { createNativeClient: config => { options = config; return f.client; } });
  assert.equal(f.connects(), 1); assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].sql, /^SELECT current_database/); assert.match(f.calls[1].sql, /^SELECT/);
  for (const catalog of ["pg_namespace", "pg_class", "pg_proc", "pg_type"]) assert.ok(f.calls[1].sql.includes(catalog));
  assert.equal(options.options, "-c search_path=public"); assert.equal(options.ssl, false);
  assert.deepEqual((await backend.pg.query("SELECT $1", [1])).rows, [{ confirmed: true }]);
  await backend.pg.exec("CREATE TABLE synthetic (id int)");
  await backend.close(); await backend.pg.close(); assert.equal(f.ends(), 1);
  await assert.rejects(backend.pg.exec("DROP TABLE synthetic"), /closed/); assert.equal(f.calls.length, 4);
});
for (const key of ["custom_schemas", "relations", "functions", "types"]) test(`reject a populated database containing ${key} before bootstrap writes`, async () => {
  const f = fake({ inventory: { custom_schemas: 0, relations: 0, functions: 0, types: 0, [key]: 1 } });
  await assert.rejects(createE2eDatabase({ nativeDatabaseUrl: url }, { createNativeClient: () => f.client }), /empty database guard/);
  assert.equal(f.ends(), 1); assert.equal(f.calls.length, 2); assert.ok(f.calls.every(call => call.sql.startsWith("SELECT")));
});
test("reject unexpected identity without continuing to inventory or bootstrap", async () => {
  const f = fake({ database: "other" });
  await assert.rejects(createE2eDatabase({ nativeDatabaseUrl: url }, { createNativeClient: () => f.client }), /identity guard/);
  assert.equal(f.calls.length, 1); assert.equal(f.ends(), 1);
});
test("failed connection is closed and sanitized even when cleanup also fails", async () => {
  const failure = new Error(`Cannot connect ${url}`); failure.code = "ECONNREFUSED";
  const f = fake({ failConnect: failure, failClose: new Error("synthetic-secret") });
  await assert.rejects(createE2eDatabase({ nativeDatabaseUrl: url }, { createNativeClient: () => f.client }), error => {
    assert.match(error.message, /connection failed \(ECONNREFUSED\)/); assert.ok(!String(error.stack).includes("synthetic-secret")); assert.equal(error.cause, undefined); return true;
  });
  assert.equal(f.ends(), 1); assert.equal(f.calls.length, 0);
});
test("query failure during guard closes client before bootstrap", async () => {
  const f = fake({ failQuery: new Error(url) });
  await assert.rejects(createE2eDatabase({ nativeDatabaseUrl: url }, { createNativeClient: () => f.client }), /identity guard/);
  assert.equal(f.ends(), 1); assert.equal(f.calls.length, 1);
});
test("idle native connection failure blocks later writes without an unhandled event", async () => {
  const f = fake();
  const backend = await createE2eDatabase({ nativeDatabaseUrl: url }, { createNativeClient: () => f.client });
  f.listeners.get("error")(new Error(url));
  await assert.rejects(backend.pg.exec("CREATE TABLE synthetic(id int)"), /connection failed/);
  assert.equal(f.calls.length, 2); await backend.close();
});
test("query errors retain constraint wording without raw or decoded credentials", async () => {
  const encoded = url.replace("synthetic-secret", "synthetic%40secret"); const f = fake();
  const backend = await createE2eDatabase({ nativeDatabaseUrl: encoded }, { createNativeClient: () => f.client });
  f.client.query = async () => { const error = new Error(`immutable ${encoded} synthetic@secret`); error.code = "P0001"; throw error; };
  await assert.rejects(backend.pg.query("UPDATE synthetic"), error => {
    assert.equal(error.code, "P0001"); assert.match(error.message, /immutable/); assert.ok(!error.message.includes("synthetic")); assert.equal(error.cause, undefined); return true;
  }); await backend.close();
});
test("only absent native configuration invokes the default PGlite path", async () => {
  const original = process.env.E2E_TEST_DATABASE_URL; delete process.env.E2E_TEST_DATABASE_URL;
  try {
    let receivedPort; const expected = { kind: "fake-pglite" };
    const result = await createE2eDatabase({ pglitePort: 3711 }, { createPGlite: port => { receivedPort = port; return expected; } });
    assert.equal(result, expected); assert.equal(receivedPort, 3711);
  } finally { if (original === undefined) delete process.env.E2E_TEST_DATABASE_URL; else process.env.E2E_TEST_DATABASE_URL = original; }
});
