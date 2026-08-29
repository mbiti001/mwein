import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

function requestStatus(port, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path: "/", headers }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
}

test("authenticated clinical API persists patients and encounters", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "mwein-test-"));
  const port = 43191;
  const password = "TestPassword2026!";
  const child = spawn(process.execPath, ["server.js"], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", PORT: String(port), DATA_DIR: dataDir, EMR_BOOTSTRAP_PASSWORD: password }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { child.kill("SIGTERM"); await rm(dataDir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server did not start")), 5000);
    child.stdout.on("data", chunk => { if (chunk.toString().includes("listening")) { clearTimeout(timeout); resolve(); } });
    child.on("error", reject);
  });
  const base = `http://127.0.0.1:${port}`;
  const healthResponse = await fetch(`${base}/api/health`);
  const health = await healthResponse.json();
  assert.equal(health.status, "ok");
  assert.equal(healthResponse.headers.get("x-content-type-options"), "nosniff");
  const readyResponse = await fetch(`${base}/api/ready`);
  assert.equal(readyResponse.status, 200);
  assert.equal((await readyResponse.json()).auditIntegrity, true);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
  assert.equal((await fetch(`${base}/data/mwein-emr.sqlite`)).status, 404);
  const indexResponse = await fetch(base);
  const indexHtml = await indexResponse.text();
  const csp = indexResponse.headers.get("content-security-policy");
  const nonce = indexHtml.match(/<script nonce="([^"]+)"/)[1];
  assert.match(csp, new RegExp(`script-src 'nonce-${nonce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  const unauthenticated = await fetch(`${base}/api/bootstrap`);
  assert.equal(unauthenticated.status, 401);
  const crossOriginLogin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ email: "clinician@mwein.local", password }) });
  assert.equal(crossOriginLogin.status, 403);
  const invalidLogin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "clinician@mwein.local", password: "incorrect" }) });
  assert.equal(invalidLogin.status, 401);
  const loginResponse = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "clinician@mwein.local", password }) });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie").split(";")[0];
  assert.match(loginResponse.headers.get("set-cookie"), /HttpOnly; SameSite=Strict; Path=\//);
  const headers = { "content-type": "application/json", cookie };
  const bootstrap = await fetch(`${base}/api/bootstrap`, { headers }).then(r => r.json());
  assert.equal(bootstrap.patients.length, 4);
  assert.equal(bootstrap.user.role, "Clinician");
  assert.equal(bootstrap.prescriptionPlugins.length, 5);
  assert.equal(bootstrap.formulary.length, 7);
  assert.equal(bootstrap.workflow.labCatalog.length, 6);
  assert.equal(bootstrap.workflow.labCatalog.find(item => item.test === "Urinalysis").resultFields.length, 8);
  assert.equal(bootstrap.workflow.labResultCommonFields.some(field => field.id === "notes"), true);
  const allergyPatient = bootstrap.patients.find(patient => patient.id === "CHU-4481-029");
  const blockedScreen = await fetch(`${base}/api/prescriptions/screen`, { method: "POST", headers, body: JSON.stringify({ patientUuid: allergyPatient.uuid, medicine: "Amoxicillin 500mg", dose: "1 tablet", frequency: "TDS", duration: "5 days" }) }).then(r => r.json());
  assert.equal(blockedScreen.screening.overall, "block");
  assert.equal(blockedScreen.screening.checks.some(check => check.pluginId === "allergy-guard" && check.severity === "block"), true);
  const blockedSave = await fetch(`${base}/api/patients/${allergyPatient.uuid}/prescriptions`, { method: "POST", headers, body: JSON.stringify({ medicine: "Amoxicillin 500mg", dose: "1 tablet", frequency: "TDS", duration: "5 days", reviewAcknowledged: true }) });
  assert.equal(blockedSave.status, 422);
  const createdResponse = await fetch(`${base}/api/patients`, { method: "POST", headers, body: JSON.stringify({ id: "TEST-001", name: "API Test Patient", phone: "+254700000001", sex: "Female", age: 30, county: "Busia", consent: "Care and claims consent recorded" }) });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const labResponse = await fetch(`${base}/api/patients/${created.patient.uuid}/lab-orders`, { method: "POST", headers, body: JSON.stringify({ testName: "Malaria RDT", priority: "Urgent" }) });
  assert.equal(labResponse.status, 201);
  const labPayload = await labResponse.json();
  assert.equal(labPayload.workflow.labWorklist.length, 1);
  assert.equal(labPayload.workflow.invoices[0].items.length, 1);
  const incompleteLab = await fetch(`${base}/api/lab-orders/${labPayload.order.uuid}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "Complete", resultData: {} }) });
  assert.equal(incompleteLab.status, 422);
  const invalidLab = await fetch(`${base}/api/lab-orders/${labPayload.order.uuid}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "Complete", resultData: { outcome: "Equivocal", specimenQuality: "Acceptable", interpretation: "Normal" } }) });
  assert.equal(invalidLab.status, 422);
  const completedLab = await fetch(`${base}/api/lab-orders/${labPayload.order.uuid}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "Complete", resultData: { outcome: "Negative", species: "Not applicable", specimenQuality: "Acceptable", interpretation: "Normal", method: "Rapid diagnostic test", notes: "No malaria antigen detected." } }) }).then(r => r.json());
  assert.equal(completedLab.workflow.labWorklist.length, 0);
  assert.equal(completedLab.workflow.invoices[0].items.length, 1);
  const fbcResponse = await fetch(`${base}/api/patients/${created.patient.uuid}/lab-orders`, { method: "POST", headers, body: JSON.stringify({ testName: "Full Blood Count", priority: "Routine" }) });
  const fbc = await fbcResponse.json();
  const incompleteFbc = await fetch(`${base}/api/lab-orders/${fbc.order.uuid}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "Complete", resultData: { haemoglobin: "11.2", whiteCellCount: "7.1", specimenQuality: "Acceptable", interpretation: "Abnormal" } }) });
  assert.equal(incompleteFbc.status, 422);
  const outOfRangeFbc = await fetch(`${base}/api/lab-orders/${fbc.order.uuid}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "Complete", resultData: { haemoglobin: "99", whiteCellCount: "7.1", platelets: "245", specimenQuality: "Acceptable", interpretation: "Abnormal" } }) });
  assert.equal(outOfRangeFbc.status, 422);
  const undocumentedCriticalFbc = await fetch(`${base}/api/lab-orders/${fbc.order.uuid}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "Complete", resultData: { haemoglobin: "3.2", whiteCellCount: "7.1", platelets: "245", specimenQuality: "Acceptable", interpretation: "Critical" } }) });
  assert.equal(undocumentedCriticalFbc.status, 422);
  const completedFbc = await fetch(`${base}/api/lab-orders/${fbc.order.uuid}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "Complete", resultData: { haemoglobin: "11.2", whiteCellCount: "7.1", platelets: "245", neutrophils: "53", mcv: "86", specimenQuality: "Acceptable", interpretation: "Abnormal", referenceContext: "Adult female interval", notes: "Mild anaemia pattern; correlate clinically." } }) }).then(r => r.json());
  assert.equal(completedFbc.workflow.labOrders.find(order => order.uuid === fbc.order.uuid).result.includes("Haemoglobin: 11.2 g/dL"), true);
  assert.equal(completedFbc.workflow.invoices[0].items.length, 2);
  const cancelledLabResponse = await fetch(`${base}/api/patients/${created.patient.uuid}/lab-orders`, { method: "POST", headers, body: JSON.stringify({ testName: "Urinalysis", priority: "Routine" }) });
  const cancelledLab = await cancelledLabResponse.json();
  assert.equal(cancelledLab.workflow.invoices[0].items.length, 3);
  const afterCancel = await fetch(`${base}/api/lab-orders/${cancelledLab.order.uuid}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "Cancelled" }) }).then(r => r.json());
  assert.equal(afterCancel.workflow.invoices[0].items.length, 2);
  const reviewScreen = await fetch(`${base}/api/prescriptions/screen`, { method: "POST", headers, body: JSON.stringify({ patientUuid: created.patient.uuid, medicine: "ORS sachets", dose: "1 sachet", frequency: "TDS", duration: "3 days" }) }).then(r => r.json());
  assert.equal(reviewScreen.screening.overall, "review");
  const unacknowledgedReview = await fetch(`${base}/api/patients/${created.patient.uuid}/prescriptions`, { method: "POST", headers, body: JSON.stringify({ medicine: "ORS sachets", dose: "1 sachet", frequency: "TDS", duration: "3 days" }) });
  assert.equal(unacknowledgedReview.status, 422);
  const prescriptionResponse = await fetch(`${base}/api/patients/${created.patient.uuid}/prescriptions`, { method: "POST", headers, body: JSON.stringify({ medicine: "Paracetamol 500mg", dose: "1 tablet", frequency: "TDS", duration: "3 days" }) });
  assert.equal(prescriptionResponse.status, 201);
  const prescriptionPayload = await prescriptionResponse.json();
  assert.equal(prescriptionPayload.workflow.invoices[0].items.length, 3);
  const duplicateScreen = await fetch(`${base}/api/prescriptions/screen`, { method: "POST", headers, body: JSON.stringify({ patientUuid: created.patient.uuid, medicine: "Paracetamol 500mg", dose: "1 tablet", frequency: "TDS", duration: "3 days" }) }).then(r => r.json());
  assert.equal(duplicateScreen.screening.overall, "block");
  const removableResponse = await fetch(`${base}/api/patients/${created.patient.uuid}/prescriptions`, { method: "POST", headers, body: JSON.stringify({ medicine: "Metformin 500mg", dose: "1 tablet", frequency: "BD", duration: "30 days", quantity: "30" }) });
  assert.equal(removableResponse.status, 201);
  const removable = await removableResponse.json();
  assert.equal(removable.workflow.invoices[0].items.length, 4);
  const removed = await fetch(`${base}/api/prescriptions/${removable.prescription.uuid}`, { method: "DELETE", headers }).then(r => r.json());
  assert.equal(removed.workflow.invoices[0].items.length, 3);
  const dispensed = await fetch(`${base}/api/prescriptions/${prescriptionPayload.prescription.uuid}/status`, { method: "PATCH", headers, body: JSON.stringify({ status: "Dispensed" }) }).then(r => r.json());
  assert.equal(dispensed.workflow.pharmacyQueue.length, 0);
  assert.equal(dispensed.workflow.invoices[0].items.length, 3);
  const deleteDispensed = await fetch(`${base}/api/prescriptions/${prescriptionPayload.prescription.uuid}`, { method: "DELETE", headers });
  assert.equal(deleteDispensed.status, 409);
  const draftPrescriptions = await fetch(`${base}/api/patients/${created.patient.uuid}/prescriptions`, { headers }).then(r => r.json());
  assert.equal(draftPrescriptions.prescriptions.length, 1);
  const encounterResponse = await fetch(`${base}/api/encounters`, { method: "POST", headers, body: JSON.stringify({ patientUuid: created.patient.uuid, diagnosis: "Test diagnosis", vitals: { temperature: "37 C" }, summary: "Test visit" }) });
  assert.equal(encounterResponse.status, 201);
  const nextVisitPrescriptions = await fetch(`${base}/api/patients/${created.patient.uuid}/prescriptions`, { headers }).then(r => r.json());
  assert.equal(nextVisitPrescriptions.prescriptions.length, 0);
  const signedWorkflow = await fetch(`${base}/api/patients/${created.patient.uuid}/workflow`, { headers }).then(r => r.json());
  assert.equal(signedWorkflow.workflow.invoices[0].status, "Ready");
  assert.equal(signedWorkflow.workflow.invoices[0].items.length, 3);
  const logoutResponse = await fetch(`${base}/api/auth/logout`, { method: "POST", headers });
  assert.equal(logoutResponse.status, 200);
  const expiredSession = await fetch(`${base}/api/bootstrap`, { headers });
  assert.equal(expiredSession.status, 401);
  const backup = spawn(process.execPath, ["scripts/backup.js"], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: dataDir, BACKUP_DIR: join(dataDir, "test-backups") }, stdio: ["ignore", "pipe", "pipe"] });
  const backupExit = await new Promise((resolve, reject) => {
    backup.on("exit", resolve);
    backup.on("error", reject);
  });
  assert.equal(backupExit, 0);
  const backupFiles = (await readdir(join(dataDir, "test-backups"))).filter(name => name.endsWith(".sqlite"));
  assert.equal(backupFiles.length, 1);
  const restoreCheck = spawn(process.execPath, ["scripts/verify-backup.js"], { cwd: process.cwd(), env: { ...process.env, BACKUP_PATH: join(dataDir, "test-backups", backupFiles[0]) }, stdio: ["ignore", "pipe", "pipe"] });
  const restoreExit = await new Promise((resolve, reject) => {
    restoreCheck.on("exit", resolve);
    restoreCheck.on("error", reject);
  });
  assert.equal(restoreExit, 0);
});

test("production configuration fails closed", async () => {
  const child = spawn(process.execPath, ["server.js"], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", PORT: "43192", PUBLIC_ORIGIN: "", EMR_BOOTSTRAP_PASSWORD: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  assert.notEqual(exitCode, 0);
});

test("production mode enforces HTTPS origin and secure host cookies", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "mwein-production-test-"));
  const port = 43193;
  const password = "ProductionTestPassword2026!";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATA_DIR: dataDir,
      PUBLIC_ORIGIN: `https://127.0.0.1:${port}`,
      TRUST_PROXY: "true",
      SEED_DEMO_DATA: "false",
      EMR_BOOTSTRAP_PASSWORD: password
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => { child.kill("SIGTERM"); await rm(dataDir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Production server did not start")), 5000);
    child.stdout.on("data", chunk => { if (chunk.toString().includes("listening")) { clearTimeout(timeout); resolve(); } });
    child.on("error", reject);
  });
  const base = `http://127.0.0.1:${port}`;
  const insecure = await fetch(`${base}/`);
  assert.equal(insecure.status, 426);
  assert.equal(await requestStatus(port, { host: "wrong.example.test", "x-forwarded-proto": "https" }), 421);
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `https://127.0.0.1:${port}`, "x-forwarded-proto": "https" },
    body: JSON.stringify({ email: "clinician@mwein.local", password })
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /^__Host-mwein_session=.*; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure$/);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const bootstrap = await fetch(`${base}/api/bootstrap`, { headers: { cookie, "x-forwarded-proto": "https" } }).then(response => response.json());
  assert.equal(bootstrap.patients.length, 0);
});
