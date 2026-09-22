import { verifyPrivacy } from "./e2e-privacy.mjs";
import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminPassword = "Mwein-E2E-Password-2026!";
const authSecret = "mwein-e2e-auth-secret-at-least-thirty-two-characters";
const childProcesses = new Set();

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local test port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function run(command, args, env) {
  console.log(`E2E setup: ${path.basename(command)} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    childProcesses.add(child);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`E2E setup timed out after 90 seconds: ${path.basename(command)} ${args.join(" ")}\n${output}`));
    }, 90_000);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", (error) => { clearTimeout(timer); childProcesses.delete(child); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      childProcesses.delete(child);
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${output}`));
    });
  });
}

async function waitForServer(origin, child) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Next.js exited before becoming ready (${child.exitCode})`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not become ready: ${lastError}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function diagnosisSelectionToken(selection) {
  const payload = Buffer.from(JSON.stringify({ ...selection, expiresAt: Date.now() + 600_000 })).toString("base64url");
  const signature = createHmac("sha256", authSecret).update(`diagnosis-selection\u001f${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

const steps = [];
steps.push = function (...items) {
  items.forEach((item) => console.log(`E2E: ${item}`));
  return Array.prototype.push.apply(this, items);
};
let sessionCookie = "";
let origin = "";

async function api(label, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...(options.method && options.method !== "GET" ? { origin } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(body)}`);
  steps.push(label);
  return { response, body };
}

async function requestWithCookie(pathname, cookie, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.method && options.method !== "GET" ? { origin } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function authenticate(facilityCode, email) {
  const result = await requestWithCookie("/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ facilityCode, email, password: adminPassword }),
  });
  assert(result.response.ok, `Authentication failed for ${facilityCode}/${email}: ${JSON.stringify(result.body)}`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0] || "";
  assert(cookie, `Authentication did not issue a session for ${facilityCode}/${email}`);
  return { ...result, cookie };
}

const pg = new PGlite();
await pg.waitReady;
const configuredDbPort = Number(process.env.E2E_DB_PORT || 0);
const configuredAppPort = Number(process.env.E2E_APP_PORT || 0);
const dbPort = configuredDbPort > 0 ? configuredDbPort : await availablePort();
const appPort = configuredAppPort > 0 ? configuredAppPort : await availablePort();
const socketServer = new PGLiteSocketServer({
  db: pg,
  host: "127.0.0.1",
  port: dbPort,
  maxConnections: 20,
});
let nextProcess;

try {
  await socketServer.start();
  const baseDatabaseUrl = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable&connection_limit=1`;
  const applicationDatabaseUrl = `${baseDatabaseUrl}&pgbouncer=true`;
  const commonEnvironment = {
    DATABASE_URL: baseDatabaseUrl,
    BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
    AUTH_SECRET: authSecret,
  };

  await run("./node_modules/.bin/prisma", ["migrate", "deploy"], commonEnvironment);
  steps.push("deploy all Prisma migrations");
  await run(process.execPath, ["scripts/bootstrap.mjs"], commonEnvironment);
  steps.push("bootstrap facility, roles, administrator and catalogue");

  const facility = (await pg.query(`SELECT "id" FROM "Facility" WHERE "code" = 'MMS'`)).rows[0];
  const admin = (await pg.query(`SELECT "id", "passwordHash" FROM "User" WHERE "facilityId" = $1 AND "email" = 'admin@mwein.local'`, [facility.id])).rows[0];
  const otherFacilityId = randomUUID();
  const receptionUserId = randomUUID();
  const otherReceptionUserId = randomUUID();
  const laboratoryUserId = randomUUID();
  const temporaryUserId = randomUUID();
  const systemOnlyUserId = randomUUID();
  await pg.query(`INSERT INTO "Facility" ("id", "code", "name", "updatedAt") VALUES ($1, 'OTHER', 'Other Test Facility', CURRENT_TIMESTAMP)`, [otherFacilityId]);
  await pg.query(
    `INSERT INTO "User" ("id", "facilityId", "email", "displayName", "passwordHash", "mustChangePassword", "updatedAt") VALUES
      ($1, $2, 'shared.user@example.test', 'MMS reception', $3, false, CURRENT_TIMESTAMP),
      ($4, $5, 'shared.user@example.test', 'Other reception', $3, false, CURRENT_TIMESTAMP),
      ($6, $2, 'laboratory@example.test', 'MMS laboratory', $3, false, CURRENT_TIMESTAMP),
      ($7, $2, 'temporary@example.test', 'Temporary account', $3, true, CURRENT_TIMESTAMP)`,
    [receptionUserId, facility.id, admin.passwordHash, otherReceptionUserId, otherFacilityId, laboratoryUserId, temporaryUserId],
  );
  await pg.query(
    `INSERT INTO "UserRole" ("userId", "roleId") VALUES
      ($1, (SELECT "id" FROM "Role" WHERE "code" = 'RECEPTION')),
      ($2, (SELECT "id" FROM "Role" WHERE "code" = 'RECEPTION')),
      ($3, (SELECT "id" FROM "Role" WHERE "code" = 'LABORATORY')),
      ($4, (SELECT "id" FROM "Role" WHERE "code" = 'RECEPTION'))`,
    [receptionUserId, otherReceptionUserId, laboratoryUserId, temporaryUserId],
  );
  await pg.query(
    `INSERT INTO "User" ("id", "facilityId", "email", "displayName", "passwordHash", "mustChangePassword", "updatedAt")
     VALUES ($1, $2, 'system.only@example.test', 'System-only administrator', $3, false, CURRENT_TIMESTAMP)`,
    [systemOnlyUserId, facility.id, admin.passwordHash],
  );
  await pg.query(
    `INSERT INTO "UserRole" ("userId", "roleId") VALUES ($1, (SELECT "id" FROM "Role" WHERE "code" = 'SYSTEM_ADMIN'))`,
    [systemOnlyUserId],
  );
  for (const [email, displayName, roleCode] of [
    ["privacy@example.test", "MMS privacy officer", "DATA_PROTECTION_OFFICER"],
    ["nurse@example.test", "MMS nurse", "NURSE"],
    ["clinician@example.test", "MMS clinician", "CLINICIAN"],
    ["imaging@example.test", "MMS imaging", "IMAGING"],
    ["pharmacy@example.test", "MMS pharmacy manager", "PHARMACY_MANAGER"],
    ["billing@example.test", "MMS billing", "BILLING"],
    ["medical.director@example.test", "MMS medical director", "MEDICAL_DIRECTOR"],
    ["finance.manager@example.test", "MMS finance manager", "FINANCE_MANAGER"],
    ["facility.admin@example.test", "MMS facility administrator", "FACILITY_ADMIN"],
  ]) {
    const roleUserId = randomUUID();
    await pg.query(`INSERT INTO "User" ("id", "facilityId", "email", "displayName", "passwordHash", "mustChangePassword", "updatedAt") VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP)`, [roleUserId, facility.id, email, displayName, admin.passwordHash]);
    await pg.query(`INSERT INTO "UserRole" ("userId", "roleId") VALUES ($1, (SELECT "id" FROM "Role" WHERE "code" = $2))`, [roleUserId, roleCode]);
  }
  await pg.query(
    `INSERT INTO "UserRole" ("userId", "roleId")
     SELECT $1, "id" FROM "Role"
     WHERE "code" IN ('RECEPTION', 'NURSE', 'CLINICIAN', 'LABORATORY', 'IMAGING', 'PHARMACY_MANAGER', 'BILLING', 'MEDICAL_DIRECTOR', 'DATA_PROTECTION_OFFICER')
     ON CONFLICT DO NOTHING`,
    [admin.id],
  );
  steps.push("seed duplicate-email tenants and least-privilege roles");
  const medicine = (
    await pg.query(
      `SELECT "id" FROM "CatalogItem" WHERE "facilityId" = $1 AND "code" = 'PARACETAMOL_500'`,
      [facility.id],
    )
  ).rows[0];
  assert(facility && medicine, "Bootstrap did not create the E2E facility and medicine");
  const storeId = randomUUID();
  const batchId = randomUUID();
  const locationBalanceId = randomUUID();
  const expiryDate = new Date();
  expiryDate.setUTCFullYear(expiryDate.getUTCFullYear() + 2);
  await pg.query(
    `INSERT INTO "Store" ("id", "facilityId", "code", "name") VALUES ($1, $2, 'MAIN', 'Main pharmacy')`,
    [storeId, facility.id],
  );
  await pg.query(
    `INSERT INTO "InventoryBatch" ("id", "catalogItemId", "batchNumber", "expiryDate", "quantityReceived", "quantityAvailable", "unitCost")
     VALUES ($1, $2, 'E2E-PARA-001', $3, 100, 100, 2.50)`,
    [batchId, medicine.id, expiryDate.toISOString().slice(0, 10)],
  );
  await pg.query(
    `INSERT INTO "InventoryLocationBalance" ("id", "storeId", "batchId", "quantity", "updatedAt")
     VALUES ($1, $2, $3, 100, CURRENT_TIMESTAMP)`,
    [locationBalanceId, storeId, batchId],
  );
  steps.push("seed isolated pharmacy stock fixture");

  origin = `http://127.0.0.1:${appPort}`;
  const productionServer = process.env.E2E_PRODUCTION === "1";
  nextProcess = spawn("./node_modules/.bin/next", [productionServer ? "start" : "dev", ...(productionServer ? [] : ["--webpack"]), "--hostname", "127.0.0.1", "-p", String(appPort)], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: applicationDatabaseUrl,
      AUTH_SECRET: authSecret,
      APP_ORIGIN: origin,
      NODE_ENV: productionServer ? "production" : "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  childProcesses.add(nextProcess);
  console.log("E2E: waiting for application health (60-second deadline)");
  let nextOutput = "";
  nextProcess.stdout.on("data", (chunk) => (nextOutput += chunk));
  nextProcess.stderr.on("data", (chunk) => (nextOutput += chunk));
  await waitForServer(origin, nextProcess).catch((error) => {
    throw new Error(`${error.message}\n${nextOutput}`);
  });
  steps.push("start application and verify database health");

  const missingOrigin = await fetch(`${origin}/api/auth/login`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ facilityCode: "MMS", email: "admin@mwein.local", password: adminPassword }),
  });
  assert(missingOrigin.status === 403, "A cross-origin mutation without an Origin header was accepted");
  steps.push("reject mutation requests without the configured application origin");

  if (process.env.E2E_KEEP_TEMPORARY_PASSWORD !== "1") {
    const temporaryLogin = await authenticate("MMS", "temporary@example.test");
    assert(temporaryLogin.body.user.mustChangePassword === true, "Temporary account was not forced to change its password");
    const temporaryBlocked = await requestWithCookie("/api/visits", temporaryLogin.cookie);
    assert(temporaryBlocked.response.status === 403, "Temporary account could access records before changing its password");
    const permanentPassword = "Mwein-E2E-Permanent-Password-2026!";
    const changedPassword = await requestWithCookie("/api/auth/password", temporaryLogin.cookie, {
      method: "POST",
      body: JSON.stringify({ currentPassword: adminPassword, newPassword: permanentPassword }),
    });
    assert(changedPassword.response.ok, `Temporary password replacement failed: ${JSON.stringify(changedPassword.body)}`);
    const temporaryAllowed = await requestWithCookie("/api/visits", temporaryLogin.cookie);
    assert(temporaryAllowed.response.ok, "Account remained blocked after replacing its temporary password");
    steps.push("enforce temporary-password replacement before record access");
  }

  const systemOnlyLogin = await authenticate("MMS", "system.only@example.test");
  const systemOnlyClinical = await requestWithCookie("/api/visits", systemOnlyLogin.cookie);
  const systemOnlyAdministration = await requestWithCookie("/api/admin/overview", systemOnlyLogin.cookie);
  assert(systemOnlyClinical.response.status === 403, "A system-administrator-only account could open clinical visits");
  assert(systemOnlyAdministration.response.ok, "A system-administrator-only account could not open administration");
  steps.push("keep system-administrator-only accounts out of clinical records");

  const login = await api("authenticate system administrator", "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ facilityCode: "MMS", email: "admin@mwein.local", password: adminPassword }),
  });
  sessionCookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
  assert(sessionCookie, "Login did not issue a session cookie");

  const identityBoundary = await api("verify workforce identity boundary", "/api/admin/identity");
  assert(identityBoundary.body.configuration.configured === false && identityBoundary.body.roles.every((item) => item.code !== "SYSTEM_ADMIN"), "Identity boundary was enabled without OIDC or exposed system-administrator mapping");
  const catalogueBeforeSchedule = await api("load catalogue pricing", "/api/catalog");
  const scheduledItem = catalogueBeforeSchedule.body.items.find(item => item.code === "PARACETAMOL_500");
  assert(scheduledItem, "Seeded medicine was absent from the catalogue");
  const scheduledUnitPrice = Number(scheduledItem.unitPrice) + 5;
  const scheduledDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await api("schedule effective catalogue price", "/api/catalog", {
    method: "PATCH",
    body: JSON.stringify({
      ...scheduledItem,
      unitPrice: scheduledUnitPrice,
      priceEffectiveFrom: scheduledDate,
      priceChangeReason: "E2E approved future tariff test",
    }),
  });
  const catalogueAfterSchedule = await api("verify scheduled catalogue price", "/api/catalog");
  const scheduledResult = catalogueAfterSchedule.body.items.find(item => item.id === scheduledItem.id);
  assert(Number(scheduledResult.unitPrice) === Number(scheduledItem.unitPrice), "Future tariff changed today's catalogue price");
  assert(Number(scheduledResult.upcomingPrice?.unitPrice) === scheduledUnitPrice, "Future tariff was not retained in the price schedule");
  const safetyDraft = await api("create governed medication safety draft", "/api/admin/medication-safety", { method: "POST", body: JSON.stringify({ action: "CREATE_DRAFT", code: "E2E-SAFETY", version: "1.0", severity: "WARNING", primaryConceptId: "paracetamol", sourceReference: "E2E governed protocol version 1", rule: { kind: "ALLERGY", message: "E2E governed allergy test warning." } }) });
  const medicalDirector = await authenticate("MMS", "medical.director@example.test");
  const safetyApproval = await requestWithCookie("/api/admin/medication-safety", medicalDirector.cookie, { method: "POST", body: JSON.stringify({ action: "APPROVE", id: safetyDraft.body.rule.id, reason: "Independent E2E clinical governance review completed" }) });
  assert(safetyApproval.response.ok && safetyApproval.body.rule.status === "APPROVED", `Independent medication-rule approval failed: ${JSON.stringify(safetyApproval.body)}`);
  steps.push("verify two-person medication safety governance");
  const operationsEvidence = await api("record operations evidence", "/api/admin/operations-evidence", { method: "POST", body: JSON.stringify({ action: "CREATE", kind: "AUDIT_EXPORT", status: "SUCCESS", title: "E2E verified audit export", occurredAt: new Date().toISOString(), evidenceReference: "e2e://audit-export/checksum", notes: "Integration-test evidence only" }) });
  const facilityAdministrator = await authenticate("MMS", "facility.admin@example.test");
  const evidenceVerification = await requestWithCookie("/api/admin/operations-evidence", facilityAdministrator.cookie, { method: "POST", body: JSON.stringify({ action: "VERIFY", id: operationsEvidence.body.record.id, note: "Independent E2E verification complete" }) });
  assert(evidenceVerification.response.ok && evidenceVerification.body.record.verifiedAt, `Operations evidence verification failed: ${JSON.stringify(evidenceVerification.body)}`);
  steps.push("verify two-person operations evidence register");

  const patientResult = await api("register patient", "/api/patients", {
    method: "POST",
    body: JSON.stringify({
      givenName: "Amina",
      familyName: "E2E Patient",
      dateOfBirth: "1992-04-14",
      sexAtBirth: "FEMALE",
      phone: "+254700000001",
      shaNumber: "SHA-E2E-0001",
      county: "Nairobi",
      subcounty: "Westlands",
      preferredLanguage: "English",
      treatmentConsent: true,
      electronicRecordConsent: true,
      messagingConsent: true,
    }),
  });
  const patient = patientResult.body.patient;
  assert(patient.patientNumber?.startsWith("MMS-"), "Patient number was not assigned");
  const dependantResult = await api("register dependant sharing guardian phone", "/api/patients", {
    method: "POST",
    body: JSON.stringify({
      registrationMode: "GUARDIAN_ASSISTED", givenName: "Child", familyName: "E2E Patient", estimatedAgeYears: 4,
      sexAtBirth: "MALE", phone: "+254700000001", county: "Nairobi", subcounty: "Westlands",
      treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false,
      representativeName: "Amina E2E Patient", representativeRelationship: "Parent",
    }),
  });
  assert(dependantResult.response.status === 201 && dependantResult.body.patient.identityStatus === "REPRESENTATIVE_ASSERTED", "Shared guardian phone was treated as a unique identity");
  const unidentifiedResult = await api("register unidentified emergency patient", "/api/patients", {
    method: "POST",
    body: JSON.stringify({ registrationMode: "EMERGENCY_UNKNOWN", lawfulBasis: "VITAL_INTERESTS", emergencyReason: "Patient arrived unconscious without identification" }),
  });
  assert(unidentifiedResult.response.status === 201 && unidentifiedResult.body.patient.identityStatus === "UNIDENTIFIED" && unidentifiedResult.body.patient.restricted === true, "Emergency registration invented identity or failed to restrict the record");
  steps.push("verify shared guardian contact and unidentified emergency registration");

  await verifyPrivacy({ api, requestWithCookie, authenticate, patient, assert, steps, origin });

  await pg.query(`UPDATE "CatalogPriceVersion" SET "unitPrice" = 650 WHERE "catalogItemId" IN (SELECT "id" FROM "CatalogItem" WHERE "facilityId" = $1 AND "code" = 'CONSULT-OUTPATIENT')`, [facility.id]);
  const shaCancellationVisit = await api("open visit for SHA eligibility outcome", "/api/visits", {
    method: "POST",
    body: JSON.stringify({ patientId: patient.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN" }),
  });
  assert(Number(shaCancellationVisit.body.visit.invoice.items[0].unitPrice) === 650 && shaCancellationVisit.body.visit.invoice.items[0].priceVersionId, "Check-in did not use the clinic tariff and price version");
  await pg.query(`UPDATE "CatalogPriceVersion" SET "unitPrice" = 500 WHERE "catalogItemId" IN (SELECT "id" FROM "CatalogItem" WHERE "facilityId" = $1 AND "code" = 'CONSULT-OUTPATIENT')`, [facility.id]);
  await api("cancel visit after documented SHA benefit check", `/api/visits/${shaCancellationVisit.body.visit.id}/cancel`, {
    method: "POST",
    body: JSON.stringify({
      reasonCode: "SHA_BENEFIT_OR_ELIGIBILITY",
      shaOutcome: "BENEFIT_NOT_COVERED",
      shaEligibilityReference: "SHA-ELIG-E2E-0001",
      details: "Routine service was not available under the verified benefit; patient advised on alternatives.",
    }),
  });
  const cancelledState = (await pg.query(
    `SELECT v."status" AS "visitStatus", i."status" AS "invoiceStatus", c."shaOutcome", c."shaEligibilityReference", c."policyVersion",
            (SELECT COUNT(*)::int FROM "QueueEntry" q WHERE q."visitId" = v."id" AND q."status" = 'CANCELLED') AS "cancelledQueues"
     FROM "Visit" v
     JOIN "Invoice" i ON i."visitId" = v."id"
     JOIN "VisitCancellation" c ON c."visitId" = v."id"
     WHERE v."id" = $1`,
    [shaCancellationVisit.body.visit.id],
  )).rows[0];
  assert(cancelledState.visitStatus === "CANCELLED" && cancelledState.invoiceStatus === "VOID", "Cancellation did not close the visit and void its invoice");
  assert(cancelledState.shaOutcome === "BENEFIT_NOT_COVERED" && cancelledState.shaEligibilityReference === "SHA-ELIG-E2E-0001" && cancelledState.policyVersion, "SHA cancellation evidence was not retained");
  assert(cancelledState.cancelledQueues === 1, "Cancellation left an active queue entry");
  const closedConsultation = await requestWithCookie(`/api/visits/${shaCancellationVisit.body.visit.id}/consultation`, sessionCookie, {
    method: "POST",
    body: JSON.stringify({ action: "SAVE_NOTES", data: { chiefComplaint: "Stale screen", historyPresentingIllness: "Attempt after cancellation", generalExamination: "Not performed", disposition: "OUTPATIENT" } }),
  });
  assert(closedConsultation.response.status === 409, "A cancelled visit accepted consultation changes");

  const emergencyVisit = await api("open emergency visit for SHA safeguard", "/api/visits", {
    method: "POST",
    body: JSON.stringify({ patientId: patient.id, clinic: "Emergency", priority: "EMERGENCY", visitType: "EMERGENCY" }),
  });
  const emergencyShaCancellation = await requestWithCookie(`/api/visits/${emergencyVisit.body.visit.id}/cancel`, sessionCookie, {
    method: "POST",
    body: JSON.stringify({
      reasonCode: "SHA_BENEFIT_OR_ELIGIBILITY",
      shaOutcome: "COVERAGE_INACTIVE",
      shaEligibilityReference: "SHA-ELIG-E2E-EMERGENCY",
      details: "Emergency eligibility safeguard test.",
    }),
  });
  assert(emergencyShaCancellation.response.status === 409 && emergencyShaCancellation.body.reason?.includes("Do not delay"), "SHA eligibility was allowed to cancel emergency care");
  await api("redirect emergency visit without using eligibility as a barrier", `/api/visits/${emergencyVisit.body.visit.id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reasonCode: "CLINICAL_REDIRECTION", details: "Transferred to a higher-acuity emergency department with handover documented." }),
  });
  steps.push("verify governed cancellation and SHA emergency-care safeguard");

  const adolescentResult = await api("register adolescent ANC patient", "/api/patients", {
    method: "POST",
    body: JSON.stringify({
      givenName: "Safiya",
      familyName: "ANC Safety",
      estimatedAgeYears: 14,
      sexAtBirth: "FEMALE",
      phone: "+254700000014",
      county: "Nairobi",
      subcounty: "Westlands",
      preferredLanguage: "English",
      treatmentConsent: true,
      electronicRecordConsent: true,
      messagingConsent: false,
    }),
  });
  const adolescent = adolescentResult.body.patient;
  const unconfirmedAnc = await requestWithCookie("/api/visits", sessionCookie, {
    method: "POST",
    body: JSON.stringify({ patientId: adolescent.id, clinic: "ANC", priority: "ROUTINE", visitType: "WALK_IN" }),
  });
  assert(unconfirmedAnc.response.status === 422, "ANC admitted a patient without pregnancy confirmation");
  steps.push("block unconfirmed routine ANC admission");
  const negativeAnc = await requestWithCookie("/api/visits", sessionCookie, {
    method: "POST",
    body: JSON.stringify({ patientId: adolescent.id, clinic: "ANC", priority: "ROUTINE", visitType: "WALK_IN", ancEvidence: { result: "NEGATIVE", method: "FACILITY_LAB", testedAt: new Date().toISOString().slice(0, 10), evidenceReference: "UPT-E2E-NEGATIVE", consentConfirmed: true } }),
  });
  assert(negativeAnc.response.status === 422, "ANC admitted a patient with a negative pregnancy test");
  steps.push("route negative pregnancy tests away from routine ANC");
  const adolescentAnc = await api("admit confirmed adolescent to ANC with safeguarding review", "/api/visits", {
    method: "POST",
    body: JSON.stringify({ patientId: adolescent.id, clinic: "ANC", priority: "ROUTINE", visitType: "WALK_IN", ancEvidence: { result: "POSITIVE", method: "FACILITY_LAB", testedAt: new Date().toISOString().slice(0, 10), evidenceReference: "UPT-E2E-POSITIVE", consentConfirmed: true } }),
  });
  assert(adolescentAnc.body.visit.ancAdmissionEvidence?.safeguardingReviewRequired === true, "Confirmed pregnant adolescent was not flagged for confidential safeguarding review");
  const ancLnmpDate = new Date();
  ancLnmpDate.setUTCDate(ancLnmpDate.getUTCDate() - 70);
  const ancLnmp = ancLnmpDate.toISOString().slice(0, 10);
  const expectedAncEddDate = new Date(`${ancLnmp}T00:00:00.000Z`);
  expectedAncEddDate.setUTCDate(expectedAncEddDate.getUTCDate() + 280);
  const adolescentTriage = await api("calculate and retain ANC dating from LNMP", `/api/visits/${adolescentAnc.body.visit.id}/triage`, {
    method: "POST",
    body: JSON.stringify({
      chiefComplaint: "Routine confirmed pregnancy ANC booking",
      temperatureC: 36.7,
      pulseBpm: 82,
      respiratoryRate: 17,
      systolicBp: 112,
      diastolicBp: 72,
      oxygenSaturation: 98,
      weightKg: 52,
      heightCm: 158,
      painScore: 0,
      consciousness: "ALERT",
      triageCategory: "PRIORITY",
      pregnancyStatus: "PREGNANT",
      lastMenstrualPeriod: ancLnmp,
      notes: "Confidential adolescent ANC triage",
    }),
  });
  assert(adolescentTriage.body.visit.triage.estimatedDeliveryDate.slice(0, 10) === expectedAncEddDate.toISOString().slice(0, 10), "Triage EDD was not calculated as LNMP plus 280 days");
  assert(adolescentTriage.body.visit.triage.gestationalAgeWeeks === 10 && [0, 1].includes(adolescentTriage.body.visit.triage.gestationalAgeDays), "Triage gestational age was not calculated from LNMP using the facility date");
  const missingSafeguarding = await requestWithCookie("/api/service-points", sessionCookie, {
    method: "POST",
    body: JSON.stringify({
      action: "SAVE_ASSESSMENT",
      visitId: adolescentAnc.body.visit.id,
      servicePoint: "ANC",
      templateVersion: "KE-ANC-2026.4",
      data: { gravida: "1", para: "0", abortions: "0", livingChildren: "0", lmp: ancLnmp, edd: "1900-01-01", gestationWeeks: "99", dangerSigns: "Reviewed — none reported", birthPreparedness: "Initial counselling started", carePlan: "Continue ANC and clinical review" },
      riskLevel: "INCREASED",
    }),
  });
  assert(missingSafeguarding.response.status === 422, "Adolescent ANC assessment saved without the required safeguarding assessment and action");
  steps.push("require confidential clinician safeguarding documentation for under-15 ANC");
  const implausibleObstetricHistory = await requestWithCookie("/api/service-points", sessionCookie, {
    method: "POST",
    body: JSON.stringify({
      action: "SAVE_ASSESSMENT",
      visitId: adolescentAnc.body.visit.id,
      servicePoint: "ANC",
      templateVersion: "KE-ANC-2026.4",
      data: { gravida: "31", para: "30", abortions: "0", livingChildren: "30", lmp: ancLnmp, edd: "1900-01-01", gestationWeeks: "99", dangerSigns: "Reviewed — none reported", safeguardingAssessment: "Private, non-judgemental immediate-safety assessment completed", safeguardingAction: "Senior clinical review and facility child-protection pathway initiated", birthPreparedness: "Initial counselling started", carePlan: "Continue ANC and clinical review" },
      riskLevel: "HIGH",
    }),
  });
  assert(implausibleObstetricHistory.response.status === 422 && implausibleObstetricHistory.body.reason?.includes("Gravida cannot exceed 30"), "ANC accepted an implausible gravida above the configured capture limit");
  steps.push("block implausible obstetric counts and explain the allowed range");
  const adolescentAssessment = await api("canonicalize structured ANC dating from LNMP", "/api/service-points", {
    method: "POST",
    body: JSON.stringify({
      action: "SAVE_ASSESSMENT",
      visitId: adolescentAnc.body.visit.id,
      servicePoint: "ANC",
      templateVersion: "KE-ANC-2026.4",
      data: { gravida: "1", para: "0", abortions: "0", livingChildren: "0", lmp: ancLnmp, edd: "1900-01-01", gestationWeeks: "99", dangerSigns: "Reviewed — none reported", safeguardingAssessment: "Private, non-judgemental immediate-safety assessment completed", safeguardingAction: "Senior clinical review and facility child-protection pathway initiated", birthPreparedness: "Initial counselling started", carePlan: "Continue ANC and clinical review" },
      riskLevel: "INCREASED",
    }),
  });
  assert(adolescentAssessment.body.record.data.edd === expectedAncEddDate.toISOString().slice(0, 10), "Structured ANC EDD trusted a client value instead of recalculating from LNMP");
  assert(adolescentAssessment.body.record.data.gestationWeeks === "10" && ["0", "1"].includes(adolescentAssessment.body.record.data.gestationDays), "Structured ANC gestational age did not use the shared LNMP calculation");
  const ancQueues = await api("load adolescent ANC queue state", "/api/queues");
  const adolescentConsultationQueue = ancQueues.body.entries.find(entry => entry.visitId === adolescentAnc.body.visit.id && entry.servicePoint === "CONSULTATION" && entry.status === "IN_PROGRESS");
  assert(adolescentConsultationQueue, "Adolescent ANC assessment did not retain its consultation queue state");
  await api("transfer adolescent ANC for continued managed care", "/api/queues", {
    method: "POST",
    body: JSON.stringify({ action: "TRANSFER", queueEntryId: adolescentConsultationQueue.id, targetServicePoint: "BILLING", reason: "E2E workflow handoff after ANC dating and safeguarding checks" }),
  });

  const appointmentTime = new Date(Date.now() + 7 * 86400000);
  appointmentTime.setUTCHours(7, 0, 0, 0);
  const appointmentResult = await api("book follow-up appointment", "/api/appointments", { method: "POST", body: JSON.stringify({ patientId: patient.id, scheduledAt: appointmentTime.toISOString(), clinic: "Outpatient", notes: "E2E follow-up" }) });
  const appointmentId = appointmentResult.body.appointment.id;
  const reminder = await api("prepare consented appointment reminder", `/api/appointments/${appointmentId}/reminder`, { method: "POST" });
  assert(reminder.body.contact === "+254700000001" && reminder.body.message, "Appointment reminder was not prepared for the consented contact");
  await pg.query(`UPDATE "Consent" SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE "patientId" = $1 AND type = 'MESSAGING' AND "withdrawnAt" IS NULL`, [patient.id]);
  const expiredReminder = await requestWithCookie(`/api/appointments/${appointmentId}/reminder`, sessionCookie, { method: "POST" });
  assert(expiredReminder.response.status === 422, "Expired consent still allowed reminder preparation");
  await pg.query(`UPDATE "Consent" SET "expiresAt" = NULL WHERE "patientId" = $1 AND type = 'MESSAGING'`, [patient.id]);
  steps.push("verify expired consent blocks appointment reminders");
  await api("withdraw appointment messaging consent", `/api/patients/${patient.id}/consents`, { method: "POST", body: JSON.stringify({ action: "WITHDRAW", type: "MESSAGING", noticeVersion: "MWEIN-PRIVACY-2026-01", lawfulBasis: "CONSENT", reason: "Patient opted out during the E2E consent lifecycle test" }) });
  const reminderAfterWithdrawal = await requestWithCookie(`/api/appointments/${appointmentId}/reminder`, sessionCookie, { method: "POST" });
  assert(reminderAfterWithdrawal.response.status === 422, "Reminder preparation ignored withdrawn messaging consent");
  steps.push("verify consent withdrawal immediately blocks reminders");
  const rescheduledTime = new Date(appointmentTime.getTime() + 86400000);
  await api("reschedule follow-up appointment", `/api/appointments/${appointmentId}/status`, { method: "PATCH", body: JSON.stringify({ action: "RESCHEDULE", scheduledAt: rescheduledTime.toISOString(), reason: "Patient requested a different clinic day" }) });
  const appointments = await api("verify appointment reminder history", "/api/appointments?scope=all");
  assert(appointments.body.appointments.some(item => item.id === appointmentId && item.reminderDeliveries.length === 1), "Reminder delivery history was not retained after rescheduling");
  await api("mark missed follow-up appointment", `/api/appointments/${appointmentId}/status`, { method: "PATCH", body: JSON.stringify({ status: "NO_SHOW" }) });

  const visitResult = await api("open outpatient visit", "/api/visits", {
    method: "POST",
    body: JSON.stringify({
      patientId: patient.id,
      clinic: "Outpatient",
      priority: "ROUTINE",
      visitType: "WALK_IN",
    }),
  });
  const visit = visitResult.body.visit;
  const invoice = visit.invoice;

  await api("complete triage", `/api/visits/${visit.id}/triage`, {
    method: "POST",
    body: JSON.stringify({
      chiefComplaint: "Headache and fatigue without an immediate red flag",
      temperatureC: 36.8,
      pulseBpm: 78,
      respiratoryRate: 16,
      systolicBp: 118,
      diastolicBp: 76,
      oxygenSaturation: 98,
      weightKg: 64,
      heightCm: 165,
      painScore: 3,
      consciousness: "ALERT",
      triageCategory: "ROUTINE",
      pregnancyStatus: "NOT_PREGNANT",
      notes: "Stable for routine consultation",
    }),
  });

  await api("pause consultation service point", "/api/queues", { method: "POST", body: JSON.stringify({ action: "SET_PAUSED", servicePoint: "CONSULTATION", paused: true, reason: "E2E operational pause check" }) });
  const pausedCall = await requestWithCookie("/api/queues", sessionCookie, { method: "POST", body: JSON.stringify({ action: "CALL_NEXT", servicePoint: "CONSULTATION" }) });
  assert(pausedCall.response.status === 409, "A paused service point called the next patient");
  await api("resume consultation service point", "/api/queues", { method: "POST", body: JSON.stringify({ action: "SET_PAUSED", servicePoint: "CONSULTATION", paused: false }) });
  await api("set consultation queue target", "/api/queues", { method: "POST", body: JSON.stringify({ action: "SET_TARGET", servicePoint: "CONSULTATION", targetMinutes: 25 }) });
  const calledQueue = await api("call next consultation by priority", "/api/queues", { method: "POST", body: JSON.stringify({ action: "CALL_NEXT", servicePoint: "CONSULTATION" }) });
  await api("start called consultation", "/api/queues", { method: "POST", body: JSON.stringify({ action: "START", queueEntryId: calledQueue.body.entry.id }) });

  await api("save consultation notes", `/api/visits/${visit.id}/consultation`, {
    method: "POST",
    body: JSON.stringify({
      action: "SAVE_NOTES",
      data: {
        chiefComplaint: "Headache and fatigue",
        complaints: [
          { complaint: "Headache", durationValue: 2, durationUnit: "DAYS" },
          { complaint: "Fatigue", durationValue: 2, durationUnit: "DAYS" },
        ],
        historyPresentingIllness: "Intermittent mild headache and fatigue for two days without red-flag symptoms.",
        symptomDuration: "2 days",
        reviewOfSystems: "No vomiting, weakness or visual disturbance.",
        pastMedicalHistory: "No known chronic condition.",
        currentMedicines: "None reported.",
        familySocialHistory: "No material risk reported.",
        generalExamination: "Well appearing and clinically stable.",
        systemicExamination: "Neurological examination grossly normal.",
        plan: "Supportive care, safety-net advice and referral record.",
        disposition: "OUTPATIENT",
      },
    }),
  });

  await api("record primary ICD-11 diagnosis", `/api/visits/${visit.id}/consultation`, {
    method: "POST",
    body: JSON.stringify({
      action: "SAVE_DIAGNOSIS",
      data: {
        code: "MG30.0",
        title: "Acute headache",
        selectionToken: diagnosisSelectionToken({
          facilityId: facility.id,
          code: "MG30.0",
          title: "Acute headache",
          source: "Facility history",
        }),
        type: "FINAL",
        primary: true,
      },
    }),
  });

  const referralResult = await api("create referral", "/api/referrals", {
    method: "POST",
    body: JSON.stringify({
      visitId: visit.id,
      idempotencyKey: randomUUID(),
      type: "EXTERNAL",
      referringDepartment: "General OPD",
      reason: "Specialist review if symptoms persist",
      clinicalSummary: "Stable adult with a two-day intermittent headache and no current red flags.",
      diagnosisSummary: "MG30.0 · Acute headache",
      urgency: "ROUTINE",
      attachments: [],
      receivingFacility: "E2E Referral Hospital",
      receivingDepartment: "Medical outpatient clinic",
    }),
  });
  await api("send referral", `/api/referrals/${referralResult.body.referral.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "SENT" }),
  });

  await api("submit prescription", `/api/visits/${visit.id}/consultation`, {
    method: "POST",
    body: JSON.stringify({
      action: "SAVE_PRESCRIPTION",
      data: {
        submit: true,
        idempotencyKey: randomUUID(),
        prescriptions: [
          {
            medicineCode: "PARACETAMOL_500",
            indication: "Acute headache",
            dose: "500 mg",
            doseQuantity: 1,
            route: "Oral",
            frequency: "Twice daily",
            frequencyPerDay: 2,
            duration: "5 days",
            durationDays: 5,
            startDate: new Date().toISOString().slice(0, 10),
            quantity: 10,
            quantityConfirmed: true,
            instructions: "Take one tablet twice daily after food for five days.",
            doseTiming: "SCHEDULED",
          },
        ],
      },
    }),
  });

  await api("sign consultation", `/api/visits/${visit.id}/consultation`, {
    method: "POST",
    body: JSON.stringify({ action: "SIGN", data: { disposition: "OUTPATIENT" } }),
  });

  const problemResult = await api("record longitudinal patient problem", `/api/patients/${patient.id}/problems`, {
    method: "POST",
    body: JSON.stringify({ description: "Recurrent headache", codeSystem: "ICD-11 MMS", code: "MG30.0" }),
  });
  const clinicalHistory = await api("load longitudinal clinical history", `/api/patients/${patient.id}/history?exclude=${visit.id}`);
  assert(clinicalHistory.body.problems.some((problem) => problem.id === problemResult.body.problem.id && problem.clinicalStatus === "ACTIVE"), "Longitudinal problem did not persist across the patient record");
  assert(clinicalHistory.body.timeline.some((event) => event.type === "APPOINTMENT"), "Longitudinal patient timeline omitted appointment events");
  assert(clinicalHistory.body.timeline.some((event) => event.type === "VISIT" && event.detail.includes("SHA eligibility or benefit outcome") && event.detail.includes("BENEFIT NOT COVERED")), "Longitudinal history omitted the documented SHA cancellation outcome");

  const [mmsReception, otherReception, laboratory] = await Promise.all([
    authenticate("MMS", "shared.user@example.test"),
    authenticate("OTHER", "shared.user@example.test"),
    authenticate("MMS", "laboratory@example.test"),
  ]);
  assert(mmsReception.body.user.facility.code === "MMS", "Tenant-aware login selected the wrong facility");
  assert(otherReception.body.user.facility.code === "OTHER", "Same-email login crossed tenant boundaries");
  const otherVisits = await requestWithCookie("/api/visits", otherReception.cookie);
  assert(otherVisits.response.ok && otherVisits.body.visits.length === 0, "A user could see another facility's active visit");

  const receptionVisits = await requestWithCookie("/api/visits", mmsReception.cookie);
  const receptionVisit = receptionVisits.body.visits.find((item) => item.id === visit.id);
  assert(receptionVisit, "Reception did not receive the operational visit queue");
  assert(!("reason" in receptionVisit) && !("triage" in receptionVisit) && !("encounters" in receptionVisit) && !("orders" in receptionVisit) && !("invoice" in receptionVisit), "Reception received clinical or financial visit details");
  assert(!("contacts" in receptionVisit.patient) && !("identifiers" in receptionVisit.patient) && !("allergies" in receptionVisit.patient), "Reception queue received unnecessary patient details");
  const historyDenied = await requestWithCookie(`/api/patients/${patient.id}/history`, mmsReception.cookie);
  assert(historyDenied.response.status === 403, "Reception could open longitudinal clinical history");

  const laboratoryVisits = await requestWithCookie("/api/visits", laboratory.cookie);
  const laboratoryVisit = laboratoryVisits.body.visits.find((item) => item.id === visit.id);
  assert(laboratoryVisit, "Laboratory did not receive the operational visit queue");
  assert(!("triage" in laboratoryVisit) && !("encounters" in laboratoryVisit) && !("invoice" in laboratoryVisit), "Laboratory received unrelated clinical or billing details");
  assert((laboratoryVisit.orders || []).every((order) => order.type === "LABORATORY"), "Laboratory received another department's orders");
  steps.push("verify tenant isolation and role-scoped visit projections");

  const activeVisits = await api("load pharmacy work queue", "/api/visits");
  const queuedVisit = activeVisits.body.visits.find((item) => item.id === visit.id);
  const medicationOrder = queuedVisit?.orders.find((order) => order.type === "MEDICATION");
  assert(queuedVisit?.status === "AWAITING_PHARMACY", "Visit did not enter the pharmacy queue");
  assert(medicationOrder, "Prescription was not available in the pharmacy queue");

  const dispensingPlan = await api(
    "verify FEFO dispensing plan",
    `/api/orders/${medicationOrder.id}/dispense?quantity=10`,
  );
  assert(dispensingPlan.body.available === 100, "Seeded stock was not available to dispense");
  assert(dispensingPlan.body.allocation?.[0]?.batchNumber === "E2E-PARA-001", "FEFO did not select the expected batch");

  const dispensation = await api("dispense prescribed medicine", `/api/orders/${medicationOrder.id}/dispense`, {
    method: "POST",
    body: JSON.stringify({
      action: "DISPENSE",
      idempotencyKey: randomUUID(),
      quantity: 10,
      counsellingCompleted: true,
      notes: "Dose, route, duration and return precautions explained.",
    }),
  });
  assert(dispensation.body.dispenseStatus === "DISPENSED", "Medicine was not fully dispensed");

  const forecast = await api("generate stock forecast and reorder worklist", "/api/inventory/forecast?days=90");
  assert(forecast.body.forecasts.some(item => item.code === "PARACETAMOL_500" && item.consumed === 10), "Stock forecast omitted recorded medicine consumption");

  const shaPreflight = await api("review SHA claim readiness without submitting", `/api/invoices/${invoice.id}/claims/preflight`, {
    method: "POST",
    body: JSON.stringify({
      memberNumber: "SHA-E2E-0001",
      coveredItemIds: invoice.items.map(item => item.id),
      shaPreparation: {
        fund: "PHF",
        emergency: false,
        eligibilityReference: "E2E-ELIGIBILITY-001",
        preauthorisationRequired: false,
      },
    }),
  });
  assert(shaPreflight.body.preflight.draftReady === true, "Complete SHA draft preparation was not ready to save");
  assert(shaPreflight.body.preflight.submissionReady === false && shaPreflight.body.preflight.externalHoldCount === 2, "Unsigned contract and unavailable gateway did not keep SHA submission on external hold");

  const cashierShift = await api("open cashier shift", "/api/billing/shifts", { method: "POST", body: JSON.stringify({ action: "OPEN", openingFloat: 1000 }) });

  const payment = await api("receive payment and close visit", `/api/invoices/${invoice.id}/payments`, {
    method: "POST",
    body: JSON.stringify({ method: "CASH", amount: 550 }),
  });
  assert(payment.body.visitCompleted === true, "Settled visit did not close automatically");
  assert(payment.body.balance === 0, "Invoice retained a balance after full payment");
  const submittedShift = await api("submit cashier shift reconciliation", "/api/billing/shifts", { method: "POST", body: JSON.stringify({ action: "SUBMIT", id: cashierShift.body.shift.id, countedCash: 1550 }) });
  assert(Number(submittedShift.body.shift.variance) === 0, "Cashier shift did not reconcile expected cash");
  const financeManager = await authenticate("MMS", "finance.manager@example.test");
  const approvedShift = await requestWithCookie("/api/billing/shifts", financeManager.cookie, { method: "POST", body: JSON.stringify({ action: "APPROVE", id: cashierShift.body.shift.id, reason: "Independent E2E cash review" }) });
  assert(approvedShift.response.ok && approvedShift.body.shift.status === "APPROVED", `Cashier shift approval failed: ${JSON.stringify(approvedShift.body)}`);
  steps.push("verify independent cashier shift reconciliation");
  const reportDate = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
  const operationsReport = await api("verify department operational reporting", `/api/reports/operations?from=${reportDate}&to=${reportDate}`);
  assert(operationsReport.body.departments.queues.some(item => item.servicePoint === "CONSULTATION"), "Queue performance was missing from operational reporting");
  assert(operationsReport.body.departments.cashiers.some(item => item.cashier === "Mwein System Administrator" && item.confirmed > 0), "Cashier payment attribution was missing from operational reporting");
  const followUps = await api("load recall and follow-up worklists", "/api/follow-ups");
  assert(followUps.body.worklists.appointments.some(item => item.id === appointmentId), "Missed appointment was absent from the recall worklist");
  const dataQuality = await api("scan facility data quality", "/api/admin/data-quality");
  assert(typeof dataQuality.body.summary.incompleteVisits === "number", "Data-quality workbench did not return operational issue counts");

  const state = (
    await pg.query(
      `SELECT v."status" AS "visitStatus", i."status" AS "invoiceStatus",
              b."quantityAvailable"::text AS "batchQuantity",
              lb."quantity"::text AS "storeQuantity",
              (SELECT COUNT(*)::int FROM "Referral" r WHERE r."visitId" = v."id" AND r."status" = 'SENT') AS "sentReferrals",
              (SELECT COUNT(*)::int FROM "Dispensation" d JOIN "Prescription" p ON p."id" = d."prescriptionId" JOIN "ClinicalOrder" o ON o."id" = p."orderId" WHERE o."visitId" = v."id" AND d."status" = 'DISPENSED') AS "dispensations",
              (SELECT COUNT(*)::int FROM "MedicationSafetyAssessment" msa JOIN "Prescription" p ON p."id" = msa."prescriptionId" JOIN "ClinicalOrder" o ON o."id" = p."orderId" WHERE o."visitId" = v."id" AND msa."outcome" = 'PASS') AS "safetyAssessments",
              (SELECT COUNT(*)::int FROM "InvoiceItem" line WHERE line."invoiceId" = i."id" AND line."catalogItemId" IS NOT NULL AND line."priceVersionId" IS NOT NULL) AS "versionedCharges",
              (SELECT COUNT(*)::int FROM "AccountingJournal" j WHERE j."sourceType" = 'STOCK_MOVEMENT') AS "inventoryJournals"
       FROM "Visit" v
       JOIN "Invoice" i ON i."visitId" = v."id"
       JOIN "InventoryBatch" b ON b."id" = $2
       JOIN "InventoryLocationBalance" lb ON lb."batchId" = b."id" AND lb."storeId" = $3
       WHERE v."id" = $1`,
      [visit.id, batchId, storeId],
    )
  ).rows[0];
  assert(state.visitStatus === "COMPLETED", `Final visit status was ${state.visitStatus}`);
  assert(state.invoiceStatus === "PAID", `Final invoice status was ${state.invoiceStatus}`);
  assert(state.versionedCharges >= 1, "Catalogue charges were not linked to their effective price version");
  assert(Number(state.batchQuantity) === 90 && Number(state.storeQuantity) === 90, "Dispensing did not decrement both stock balances");
  assert(state.sentReferrals === 1, "Sent referral was not persisted");
  assert(state.dispensations === 1, "Dispensation trace was not persisted");
  assert(state.safetyAssessments === 1, "Approved medication safety assessment was not persisted");
  assert(state.inventoryJournals === 1, "Dispensing accounting journal was not posted");
  steps.push("verify final clinical, referral, stock, accounting, billing and closure state");

  const auditExport = await requestWithCookie("/api/admin/audit/export", sessionCookie);
  assert(auditExport.response.ok, `Audit export failed: ${JSON.stringify(auditExport.body)}`);
  assert(auditExport.body.chain.valid === true && Number(auditExport.body.chain.eventCount) > 0, "Audit export did not verify its serialized chain");
  assert(auditExport.response.headers.get("x-audit-export-sha256")?.length === 64, "Audit export omitted its SHA-256 digest");
  const accessEvents = auditExport.body.events.filter((event) => event.action === "CLINICAL_RECORDS_ACCESSED");
  assert(accessEvents.some((event) => JSON.parse(event.reason).context === "PATIENT_HISTORY"), "Patient history disclosure was missing from the retained audit chain");
  assert(accessEvents.some((event) => JSON.parse(event.reason).context === "VISIT_WORKLIST"), "Visit worklist disclosure was missing from the retained audit chain");
  assert(accessEvents.every((event) => event.userId && event.sessionId && event.facilityId === facility.id), "Read audit events omitted their actor/session/facility boundary");
  steps.push("verify clinical access events are retained with actor, session and facility");
  steps.push("verify facility audit chain and export digest");

  let throttled = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const denied = await requestWithCookie("/api/auth/login", "", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.55" },
      body: JSON.stringify({ facilityCode: "MMS", email: "unknown@example.test", password: "definitely-wrong" }),
    });
    throttled = denied.response.status === 429;
  }
  assert(throttled, "Repeated invalid sign-in attempts were not throttled");
  steps.push("verify persistent sign-in throttling");

  const productionReadiness = await requestWithCookie("/api/ready", "");
  assert(productionReadiness.response.status === 503 && productionReadiness.body.status === "blocked", "Production readiness did not fail closed without approvals and external controls");
  assert(Object.keys(productionReadiness.body).join(",") === "status", "Public readiness exposed internal control details");
  steps.push("verify production readiness fails closed without exposing internal controls");

  console.log(`Outpatient E2E passed (${steps.length} checks)`);
  steps.forEach((step, index) => console.log(`${index + 1}. ${step}`));
  if (process.env.E2E_HOLD === "1") {
    console.log(`Browser fixture ready at ${origin}`);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} catch (error) {
  // Print before cleanup: a broken socket shutdown must not hide the original failure.
  console.error(error);
  process.exitCode = 1;
} finally {
  const cleanupDeadline = setTimeout(() => {
    console.error("E2E cleanup exceeded 10 seconds; terminating the isolated fixture");
    process.exit(1);
  }, 10_000);
  cleanupDeadline.unref();
  for (const child of childProcesses) await stopChild(child);
  await socketServer.stop();
  // pglite-socket defers socket-close handling with setImmediate; let it detach
  // while the database is still alive, before destroying the WASM instance.
  await new Promise((resolve) => setImmediate(resolve));
  await pg.close();
  clearTimeout(cleanupDeadline);
}
