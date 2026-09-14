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
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
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
      const response = await fetch(`${origin}/api/health`);
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
let sessionCookie = "";
let origin = "";

async function api(label, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
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
  await pg.query(
    `INSERT INTO "UserRole" ("userId", "roleId")
     SELECT $1, "id" FROM "Role"
     WHERE "code" IN ('RECEPTION', 'NURSE', 'CLINICIAN', 'LABORATORY', 'IMAGING', 'PHARMACY_MANAGER', 'BILLING')
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
  nextProcess = spawn("./node_modules/.bin/next", [productionServer ? "start" : "dev", ...(productionServer ? [] : ["--webpack"]), "-p", String(appPort)], {
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
  let nextOutput = "";
  nextProcess.stdout.on("data", (chunk) => (nextOutput += chunk));
  nextProcess.stderr.on("data", (chunk) => (nextOutput += chunk));
  await waitForServer(origin, nextProcess).catch((error) => {
    throw new Error(`${error.message}\n${nextOutput}`);
  });
  steps.push("start application and verify database health");

  const missingOrigin = await fetch(`${origin}/api/auth/login`, {
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
      messagingConsent: false,
    }),
  });
  const patient = patientResult.body.patient;
  assert(patient.patientNumber?.startsWith("MMS-"), "Patient number was not assigned");

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

  const payment = await api("receive payment and close visit", `/api/invoices/${invoice.id}/payments`, {
    method: "POST",
    body: JSON.stringify({ method: "CASH", amount: 550 }),
  });
  assert(payment.body.visitCompleted === true, "Settled visit did not close automatically");
  assert(payment.body.balance === 0, "Invoice retained a balance after full payment");

  const state = (
    await pg.query(
      `SELECT v."status" AS "visitStatus", i."status" AS "invoiceStatus",
              b."quantityAvailable"::text AS "batchQuantity",
              lb."quantity"::text AS "storeQuantity",
              (SELECT COUNT(*)::int FROM "Referral" r WHERE r."visitId" = v."id" AND r."status" = 'SENT') AS "sentReferrals",
              (SELECT COUNT(*)::int FROM "Dispensation" d JOIN "Prescription" p ON p."id" = d."prescriptionId" JOIN "ClinicalOrder" o ON o."id" = p."orderId" WHERE o."visitId" = v."id" AND d."status" = 'DISPENSED') AS "dispensations",
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
  assert(Number(state.batchQuantity) === 90 && Number(state.storeQuantity) === 90, "Dispensing did not decrement both stock balances");
  assert(state.sentReferrals === 1, "Sent referral was not persisted");
  assert(state.dispensations === 1, "Dispensation trace was not persisted");
  assert(state.inventoryJournals === 1, "Dispensing accounting journal was not posted");
  steps.push("verify final clinical, referral, stock, accounting, billing and closure state");

  const auditExport = await requestWithCookie("/api/admin/audit/export", sessionCookie);
  assert(auditExport.response.ok, `Audit export failed: ${JSON.stringify(auditExport.body)}`);
  assert(auditExport.body.chain.valid === true && Number(auditExport.body.chain.eventCount) > 0, "Audit export did not verify its serialized chain");
  assert(auditExport.response.headers.get("x-audit-export-sha256")?.length === 64, "Audit export omitted its SHA-256 digest");
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
  assert(productionReadiness.body.facilities.every((item) => item.missing.length === 9), "Production readiness omitted governance gates");
  steps.push("verify production readiness fails closed until external evidence exists");

  console.log(`Outpatient E2E passed (${steps.length} checks)`);
  steps.forEach((step, index) => console.log(`${index + 1}. ${step}`));
  if (process.env.E2E_HOLD === "1") {
    console.log(`Browser fixture ready at ${origin}`);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} finally {
  for (const child of childProcesses) await stopChild(child);
  await socketServer.stop();
  await pg.close();
}
