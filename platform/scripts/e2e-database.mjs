// Fixture-only backend. Native startup is read-only until identity and empty
// database guards pass. Never reset/drop/reuse a populated database.
export function nativeDatabaseConfiguration(raw) {
  const reject = () => { throw new Error("E2E native database URL must name an explicit loopback port and dedicated mwein_e2e_* database without options"); };
  if (typeof raw !== "string" || !raw || raw !== raw.trim()) reject();
  let url;
  try { url = new URL(raw); } catch { reject(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) reject();
  if (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535) reject();
  if (!/^\/mwein_e2e_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash || raw.includes("?") || raw.includes("#")) reject();
  // Explicit credentials prevent ambient PGUSER/PGPASSWORD from choosing an account.
  if (!url.username || !url.password) reject();
  let user, password;
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); } catch { reject(); }
  if (!user || !password || /[\u0000-\u001f\u007f]/.test(user + password)) reject();
  const database = url.pathname.slice(1);
  const application = new URL(url);
  application.searchParams.set("sslmode", "disable");
  application.searchParams.set("connection_limit", "5");
  return {
    database,
    clientOptions: { host: url.hostname === "[::1]" ? "::1" : url.hostname, port: Number(url.port), user, password, database,
      ssl: false, connectionTimeoutMillis: 5000, query_timeout: 30000, statement_timeout: 30000,
      application_name: "mwein_e2e_fixture", options: "-c search_path=public" },
    databaseUrl: application.toString(), applicationDatabaseUrl: application.toString(),
    secrets: [raw, url.toString(), url.password, password],
  };
}

function safeFailure(stage, error, secrets = [], retainMessage = false) {
  const code = typeof error?.code === "string" && /^(?:[A-Z0-9]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT)$/.test(error.code) ? error.code : undefined;
  let message = retainMessage && typeof error?.message === "string" ? error.message : "";
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) message = message.split(secret).join("[redacted]");
  message = message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted database URL]").slice(0, 500);
  const failure = new Error(`E2E native database ${stage} failed${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}`);
  if (code) failure.code = code;
  return failure;
}

const EMPTY_DATABASE_SQL = `SELECT
  (SELECT COUNT(*)::int FROM pg_catalog.pg_namespace WHERE nspname <> 'public' AND nspname <> 'information_schema' AND nspname NOT LIKE 'pg\\_%' ESCAPE '\\') AS custom_schemas,
  (SELECT COUNT(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\') AS relations,
  (SELECT COUNT(*)::int FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\') AS functions,
  (SELECT COUNT(*)::int FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\') AS types`;

async function openNative(raw, createClient) {
  const config = nativeDatabaseConfiguration(raw); // Validate before importing or connecting.
  let client, endPromise, failedConnection;
  const close = () => {
    if (!endPromise) endPromise = Promise.resolve().then(() => client?.end()).catch(error => { throw safeFailure("cleanup", error, config.secrets); });
    return endPromise;
  };
  let stage = "connection";
  try {
    const factory = createClient || (async options => { const { Client } = await import("pg"); return new Client(options); });
    client = await factory(config.clientOptions);
    client.on("error", error => { failedConnection = safeFailure("connection", error, config.secrets); });
    await client.connect();
    stage = "identity guard";
    const identity = await client.query("SELECT current_database() AS database");
    if (identity.rows.length !== 1 || identity.rows[0].database !== config.database) throw new Error("Unexpected fixture database identity");
    stage = "empty database guard";
    const inventory = await client.query(EMPTY_DATABASE_SQL);
    if (inventory.rows.length !== 1 || !["custom_schemas", "relations", "functions", "types"].every(key => inventory.rows[0][key] === 0))
      throw new Error("Fixture database is not empty");
    if (failedConnection) throw failedConnection;
  } catch (error) {
    // Cleanup failure must never replace the original guarded startup failure.
    try { await close(); } catch { /* Both errors are sanitized; original stage wins. */ }
    throw safeFailure(stage, error, config.secrets);
  }
  const query = async (text, values) => {
    if (endPromise) throw new Error("E2E native database is closed");
    if (failedConnection) throw failedConnection;
    try { return await client.query(text, values); }
    catch (error) { throw safeFailure("query", error, config.secrets, true); }
  };
  return { kind: "native-postgresql", pg: { query, exec: text => query(text), close },
    databaseUrl: config.databaseUrl, applicationDatabaseUrl: config.applicationDatabaseUrl, close };
}

async function openPGlite(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("E2E PGlite requires a valid allocated loopback port");
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const pg = new PGlite();
  let socket, closed;
  const close = () => closed ||= (async () => {
    try { if (socket) await socket.stop(); }
    finally { await new Promise(resolve => setImmediate(resolve)); await pg.close(); }
  })();
  try {
    await pg.waitReady;
    socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port, maxConnections: 20 });
    await socket.start();
  } catch (error) { try { await close(); } catch {} throw error; }
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable&connection_limit=1`;
  return { kind: "pglite", pg, databaseUrl, applicationDatabaseUrl: `${databaseUrl}&pgbouncer=true`, close };
}

export async function createE2eDatabase({ nativeDatabaseUrl = process.env.E2E_TEST_DATABASE_URL, pglitePort } = {}, dependencies = {}) {
  // Only undefined means the caller selected the default. An empty variable is an error.
  if (nativeDatabaseUrl !== undefined) return openNative(nativeDatabaseUrl, dependencies.createNativeClient);
  return (dependencies.createPGlite || openPGlite)(pglitePort);
}
