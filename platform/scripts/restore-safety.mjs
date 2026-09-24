import { createHash } from "node:crypto";

export function databaseIdentity(connection) {
  if (!connection) throw new Error("Source and target database connections are required");
  let url;
  try { url = new URL(connection); } catch { throw new Error("Invalid database connection"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1))
    throw new Error("Expected an explicit PostgreSQL host and database");
  // Reject libpq connection overrides which could redirect a validated connection.
  for (const key of url.searchParams.keys())
    if (!["sslmode", "channel_binding", "connect_timeout"].includes(key))
      throw new Error("Unsupported database connection option");
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/-pooler(?=\.)/, "");
  return `${host}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
}
export function identityHash(connection) {
  return createHash("sha256").update(databaseIdentity(connection)).digest("hex");
}
export function validateRestorePlan({ sourceUrl, targetUrl, approval, backupHash, sourceSystem, targetSystem, now = Date.now() }) {
  if (databaseIdentity(sourceUrl) === databaseIdentity(targetUrl)) throw new Error("Restore target matches source database");
  if (!approval || approval.disposable !== true || !approval.approvedBy?.trim() || !approval.reference?.trim())
    throw new Error("An independently approved disposable target is required");
  const expires = Date.parse(approval.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) throw new Error("Restore approval is expired or invalid");
  if (approval.sourceIdentityHash !== identityHash(sourceUrl) || approval.targetIdentityHash !== identityHash(targetUrl))
    throw new Error("Connection identities do not match the approved plan");
  if (!/^[a-f0-9]{64}$/.test(backupHash || "") || backupHash !== approval.backupSha256)
    throw new Error("Backup checksum does not match the approved plan");
  if (!/^\d+$/.test(sourceSystem || "") || !/^\d+$/.test(targetSystem || ""))
    throw new Error("Database system identity could not be verified");
  // Conservative: cloned/shared clusters are not accepted, even for different database names.
  if (sourceSystem === targetSystem || approval.sourceSystemIdentifier !== sourceSystem || approval.targetSystemIdentifier !== targetSystem)
    throw new Error("Restore requires verified, distinct approved database systems");
}

export function connectionEnvironment(connection, inherited = process.env) {
  databaseIdentity(connection); // validate supported scheme and options before parsing
  const url = new URL(connection);
  // Do not let inherited libpq hostaddr/service/options redirect a checked URL.
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.startsWith("PG")));
  env.PGHOST = url.hostname;
  env.PGPORT = url.port || "5432";
  env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGCONNECT_TIMEOUT = "10";
  for (const [key, value] of url.searchParams) {
    const variable = { sslmode: "PGSSLMODE", channel_binding: "PGCHANNELBINDING", connect_timeout: "PGCONNECT_TIMEOUT" }[key];
    env[variable] = value;
  }
  return env;
}
