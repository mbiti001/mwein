import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const DB_PATH = process.env.DATABASE_PATH || join(DATA_DIR, "mwein-emr.sqlite");
const readSecret = name => {
  const file = process.env[`${name}_FILE`];
  return file ? readFileSync(file, "utf8").trim() : (process.env[name] || "");
};
const API_KEY = readSecret("EMR_API_KEY");
const BOOTSTRAP_PASSWORD = readSecret("EMR_BOOTSTRAP_PASSWORD") || (IS_PRODUCTION ? "" : "MweinPilot2026!");
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA === "true" || (!IS_PRODUCTION && process.env.SEED_DEMO_DATA !== "false");
const MAX_BODY_BYTES = 256 * 1024;
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);
const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 30);
const COOKIE_NAME = IS_PRODUCTION ? "__Host-mwein_session" : "mwein_session";
const loginAttempts = new Map();
const PRESCRIPTION_PLUGINS = [
  { id: "facility-formulary", name: "Facility formulary", version: "1.0.0", status: "active", mandatory: true, description: "Checks approved medicines and current facility stock flags." },
  { id: "allergy-guard", name: "Allergy guard", version: "1.0.0", status: "active", mandatory: true, description: "Screens documented allergy text against selected medicines." },
  { id: "duplicate-therapy", name: "Duplicate therapy", version: "1.0.0", status: "active", mandatory: true, description: "Detects an identical unsigned medicine order for this visit." },
  { id: "antimicrobial-review", name: "Antimicrobial review", version: "1.0.0", status: "active", mandatory: true, description: "Requires acknowledgement for antimicrobial orders." },
  { id: "paediatric-review", name: "Paediatric review", version: "1.0.0", status: "active", mandatory: true, description: "Flags paediatric prescriptions for weight-based clinical verification." }
];
const FORMULARY = [
  { medicine: "Paracetamol 500mg", stock: 240, stockStatus: "Available", category: "Analgesic", antimicrobial: false, unitPrice: 5 },
  { medicine: "Artemether/Lumefantrine 20/120mg", stock: 64, stockStatus: "Available", category: "Antimalarial", antimicrobial: false, unitPrice: 25 },
  { medicine: "ORS sachets", stock: 18, stockStatus: "Low", category: "Rehydration", antimicrobial: false, unitPrice: 30 },
  { medicine: "Zinc 20mg", stock: 0, stockStatus: "Out of stock", category: "Supplement", antimicrobial: false, unitPrice: 10 },
  { medicine: "Metformin 500mg", stock: 90, stockStatus: "Available", category: "Diabetes", antimicrobial: false, unitPrice: 8 },
  { medicine: "Amlodipine 5mg", stock: 11, stockStatus: "Low", category: "Cardiovascular", antimicrobial: false, unitPrice: 12 },
  { medicine: "Amoxicillin 500mg", stock: 48, stockStatus: "Available", category: "Antibiotic", antimicrobial: true, unitPrice: 15 }
];
const LAB_CATALOG = [
  { test: "Malaria RDT", price: 300, specimen: "Blood", resultFields: [
    { id: "outcome", label: "Malaria antigen", type: "select", options: ["Negative", "Positive", "Invalid"], required: true },
    { id: "species", label: "Species", type: "select", options: ["Not applicable", "P. falciparum", "Pan-malaria", "Mixed"], required: false },
    { id: "parasiteDensity", label: "Parasite density", type: "text", placeholder: "e.g. 2+ or parasites/µL", required: false }
  ] },
  { test: "Full Blood Count", price: 800, specimen: "Blood", resultFields: [
    { id: "haemoglobin", label: "Haemoglobin", type: "number", unit: "g/dL", placeholder: "e.g. 13.5", step: "0.1", min: 0, max: 30, required: true },
    { id: "whiteCellCount", label: "White cell count", type: "number", unit: "×10⁹/L", placeholder: "e.g. 7.2", step: "0.1", min: 0, max: 500, required: true },
    { id: "platelets", label: "Platelets", type: "number", unit: "×10⁹/L", placeholder: "e.g. 250", step: "1", min: 0, max: 2000, required: true },
    { id: "neutrophils", label: "Neutrophils", type: "number", unit: "%", placeholder: "e.g. 55", step: "0.1", min: 0, max: 100, required: false },
    { id: "mcv", label: "MCV", type: "number", unit: "fL", placeholder: "e.g. 88", step: "0.1", min: 0, max: 200, required: false }
  ] },
  { test: "Random Blood Sugar", price: 150, specimen: "Blood", resultFields: [
    { id: "glucose", label: "Glucose", type: "number", unit: "mmol/L", placeholder: "e.g. 6.1", step: "0.1", min: 0, max: 100, required: true },
    { id: "mealContext", label: "Meal context", type: "select", options: ["Random", "Fasting", "Post-prandial", "Unknown"], required: true }
  ] },
  { test: "Urinalysis", price: 250, specimen: "Urine", resultFields: [
    { id: "colour", label: "Colour", type: "select", options: ["Pale yellow", "Yellow", "Amber", "Red", "Other"], required: true },
    { id: "appearance", label: "Appearance", type: "select", options: ["Clear", "Slightly cloudy", "Cloudy", "Turbid"], required: true },
    { id: "ph", label: "pH", type: "number", placeholder: "e.g. 6.0", step: "0.1", min: 0, max: 14, required: true },
    { id: "protein", label: "Protein", type: "select", options: ["Negative", "Trace", "+", "++", "+++"], required: true },
    { id: "glucose", label: "Glucose", type: "select", options: ["Negative", "Trace", "+", "++", "+++"], required: true },
    { id: "ketones", label: "Ketones", type: "select", options: ["Negative", "Trace", "+", "++", "+++"], required: true },
    { id: "nitrites", label: "Nitrites", type: "select", options: ["Negative", "Positive"], required: true },
    { id: "leukocytes", label: "Leukocyte esterase", type: "select", options: ["Negative", "Trace", "+", "++", "+++"], required: true }
  ] },
  { test: "HbA1c", price: 1200, specimen: "Blood", resultFields: [
    { id: "hba1c", label: "HbA1c", type: "number", unit: "%", placeholder: "e.g. 6.5", step: "0.1", min: 0, max: 30, required: true }
  ] },
  { test: "Pregnancy test", price: 250, specimen: "Urine", resultFields: [
    { id: "outcome", label: "hCG result", type: "select", options: ["Negative", "Positive", "Invalid"], required: true }
  ] }
];
const LAB_RESULT_COMMON_FIELDS = [
  { id: "specimenQuality", label: "Specimen quality", type: "select", options: ["Acceptable", "Haemolysed", "Clotted", "Insufficient", "Contaminated", "Other limitation"], required: true },
  { id: "interpretation", label: "Overall interpretation", type: "select", options: ["Normal", "Abnormal", "Critical", "Inconclusive"], required: true },
  { id: "method", label: "Method or analyser", type: "text", placeholder: "e.g. rapid immunochromatographic assay or analyser model", required: false },
  { id: "referenceContext", label: "Reference context", type: "text", placeholder: "e.g. adult female reference interval or kit cut-off", required: false },
  { id: "notes", label: "Result notes", type: "textarea", placeholder: "Add interpretation, method limitations, repeat-test advice, or escalation details.", required: false }
];

function validateConfiguration() {
  const errors = [];
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) errors.push("PORT must be an integer from 1 to 65535");
  if (!Number.isFinite(SESSION_HOURS) || SESSION_HOURS < 1 || SESSION_HOURS > 24) errors.push("SESSION_HOURS must be between 1 and 24");
  if (!Number.isFinite(SESSION_IDLE_MINUTES) || SESSION_IDLE_MINUTES < 5 || SESSION_IDLE_MINUTES > 120) errors.push("SESSION_IDLE_MINUTES must be between 5 and 120");
  if (API_KEY && API_KEY.length < 32) errors.push("EMR_API_KEY must contain at least 32 characters");
  if (IS_PRODUCTION) {
    if (!PUBLIC_ORIGIN) errors.push("PUBLIC_ORIGIN is required in production");
    else {
      try { if (new URL(PUBLIC_ORIGIN).protocol !== "https:") errors.push("PUBLIC_ORIGIN must use HTTPS in production"); }
      catch { errors.push("PUBLIC_ORIGIN must be a valid absolute URL"); }
    }
    if (SEED_DEMO_DATA) errors.push("SEED_DEMO_DATA must not be enabled in production");
  }
  if (errors.length) throw new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
}
validateConfiguration();

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    uuid TEXT PRIMARY KEY,
    identifier TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    sex TEXT NOT NULL,
    age INTEGER NOT NULL CHECK(age BETWEEN 0 AND 120),
    county TEXT NOT NULL,
    subcounty TEXT NOT NULL DEFAULT '',
    residence TEXT NOT NULL DEFAULT '',
    next_of_kin TEXT NOT NULL DEFAULT '',
    program TEXT NOT NULL DEFAULT 'Cash / self-pay',
    consent TEXT NOT NULL,
    clinical_summary TEXT NOT NULL DEFAULT '',
    risk TEXT NOT NULL DEFAULT 'New',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS encounters (
    uuid TEXT PRIMARY KEY,
    patient_uuid TEXT NOT NULL REFERENCES patients(uuid),
    status TEXT NOT NULL DEFAULT 'draft',
    encounter_type TEXT NOT NULL DEFAULT 'Outpatient',
    priority TEXT NOT NULL DEFAULT 'Routine',
    department TEXT NOT NULL DEFAULT 'General outpatient',
    vitals_json TEXT NOT NULL,
    subjective TEXT NOT NULL DEFAULT '',
    objective TEXT NOT NULL DEFAULT '',
    diagnosis TEXT NOT NULL DEFAULT '',
    icd10 TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT '',
    follow_up TEXT NOT NULL DEFAULT '',
    disposition TEXT NOT NULL DEFAULT 'Home',
    summary TEXT NOT NULL DEFAULT '',
    clinician TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prescriptions (
    uuid TEXT PRIMARY KEY,
    encounter_uuid TEXT REFERENCES encounters(uuid) ON DELETE CASCADE,
    patient_uuid TEXT NOT NULL REFERENCES patients(uuid),
    medicine TEXT NOT NULL,
    dose TEXT NOT NULL,
    route TEXT NOT NULL DEFAULT 'Oral',
    frequency TEXT NOT NULL,
    duration TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Ready',
    screening_status TEXT NOT NULL DEFAULT 'not_screened',
    screening_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lab_orders (
    uuid TEXT PRIMARY KEY,
    encounter_uuid TEXT REFERENCES encounters(uuid) ON DELETE CASCADE,
    patient_uuid TEXT NOT NULL REFERENCES patients(uuid),
    test_name TEXT NOT NULL,
    specimen TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'Routine',
    status TEXT NOT NULL DEFAULT 'Ordered',
    result TEXT NOT NULL DEFAULT '',
    result_json TEXT NOT NULL DEFAULT '{}',
    price INTEGER NOT NULL CHECK(price >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoices (
    uuid TEXT PRIMARY KEY,
    patient_uuid TEXT NOT NULL REFERENCES patients(uuid),
    encounter_uuid TEXT REFERENCES encounters(uuid),
    status TEXT NOT NULL DEFAULT 'Open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoice_items (
    uuid TEXT PRIMARY KEY,
    invoice_uuid TEXT NOT NULL REFERENCES invoices(uuid) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK(source_type IN ('lab', 'prescription')),
    source_uuid TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
    unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    record_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    request_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    uuid TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    initials TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Admin', 'Clinician', 'Nurse', 'Lab', 'Pharmacy', 'Billing')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_uuid TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(patient_uuid, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_uuid, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_uuid, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_uuid, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_uuid);
  CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_events(occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all().map(column => column.name);
if (!sessionColumns.includes("last_seen_at")) db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at TEXT");
db.exec("UPDATE sessions SET last_seen_at = COALESCE(last_seen_at, created_at)");
const auditColumns = db.prepare("PRAGMA table_info(audit_events)").all().map(column => column.name);
if (!auditColumns.includes("previous_hash")) db.exec("ALTER TABLE audit_events ADD COLUMN previous_hash TEXT NOT NULL DEFAULT ''");
if (!auditColumns.includes("event_hash")) db.exec("ALTER TABLE audit_events ADD COLUMN event_hash TEXT NOT NULL DEFAULT ''");
const prescriptionColumns = db.prepare("PRAGMA table_info(prescriptions)").all().map(column => column.name);
if (!prescriptionColumns.includes("screening_status")) db.exec("ALTER TABLE prescriptions ADD COLUMN screening_status TEXT NOT NULL DEFAULT 'not_screened'");
if (!prescriptionColumns.includes("screening_json")) db.exec("ALTER TABLE prescriptions ADD COLUMN screening_json TEXT NOT NULL DEFAULT '{}'");
const labOrderColumns = db.prepare("PRAGMA table_info(lab_orders)").all().map(column => column.name);
if (!labOrderColumns.includes("result_json")) db.exec("ALTER TABLE lab_orders ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}'");

const now = () => new Date().toISOString();
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const eventDigest = (previousHash, occurredAt, actor, action, recordId, outcome, requestId) =>
  createHash("sha256").update([previousHash, occurredAt, actor, action, recordId, outcome, requestId].join("\u001f")).digest("hex");

function ensureAuditChain() {
  const rows = db.prepare("SELECT id, occurred_at, actor, action, record_id, outcome, request_id, previous_hash, event_hash FROM audit_events ORDER BY id").all();
  let previousHash = "GENESIS";
  const update = db.prepare("UPDATE audit_events SET previous_hash = ?, event_hash = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const digest = eventDigest(previousHash, row.occurred_at, row.actor, row.action, row.record_id, row.outcome, row.request_id);
      if (!row.event_hash) update.run(previousHash, digest, row.id);
      previousHash = row.event_hash || digest;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
ensureAuditChain();

function verifyAuditChain() {
  const rows = db.prepare("SELECT occurred_at, actor, action, record_id, outcome, request_id, previous_hash, event_hash FROM audit_events ORDER BY id").all();
  let previousHash = "GENESIS";
  for (const row of rows) {
    const expected = eventDigest(previousHash, row.occurred_at, row.actor, row.action, row.record_id, row.outcome, row.request_id);
    if (row.previous_hash !== previousHash || row.event_hash !== expected) return false;
    previousHash = row.event_hash;
  }
  return true;
}

function seedDatabase() {
  if (!SEED_DEMO_DATA) return;
  const count = db.prepare("SELECT count(*) AS count FROM patients").get().count;
  if (count) return;
  const patients = [
    ["CHU-4481-029", "Achieng Otieno", "+254 712 406 221", "Female", 31, "Busia", "Matayos", "Matayos", "Grace Otieno, sister", "SHA", "Care and claims consent recorded", "Penicillin allergy", "Allergy"],
    ["CHU-2259-118", "Peter Wekesa", "+254 700 111 908", "Male", 54, "Busia", "Nambale", "Nambale", "Rose Wekesa, spouse", "SHA", "Care and claims consent recorded", "Type 2 diabetes", "Diabetes"],
    ["CHU-9012-477", "Faith Naliaka", "+254 733 820 774", "Female", 26, "Bungoma", "Webuye East", "Webuye", "Moses Simiyu, partner", "Cash / self-pay", "Care and claims consent recorded", "ANC follow-up", "ANC"],
    ["CHU-6634-021", "Brian Ouma", "+254 745 188 441", "Male", 8, "Siaya", "Ugunja", "Ugunja", "Janet Ouma, mother", "Facility waiver", "Care and claims consent recorded", "Pediatric client", "Pediatric"]
  ];
  const insert = db.prepare(`INSERT INTO patients
    (uuid, identifier, name, phone, sex, age, county, subcounty, residence, next_of_kin, program, consent, clinical_summary, risk, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec("BEGIN");
  try {
    for (const patient of patients) {
      const timestamp = now();
      insert.run(randomUUID(), ...patient, timestamp, timestamp);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
seedDatabase();

function passwordHash(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

function sessionTokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function seedStaffUser() {
  const count = db.prepare("SELECT count(*) AS count FROM users").get().count;
  if (count) return;
  if (!BOOTSTRAP_PASSWORD || (IS_PRODUCTION && BOOTSTRAP_PASSWORD.length < 16)) throw new Error("EMR_BOOTSTRAP_PASSWORD with at least 16 characters is required for the first production startup");
  const salt = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO users (uuid, email, display_name, initials, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), "clinician@mwein.local", "Dr. Daniel K.", "DK", "Clinician", salt, passwordHash(BOOTSTRAP_PASSWORD, salt), now());
}
seedStaffUser();

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml"
};

function securityHeaders(requestId, nonce = "") {
  return {
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "content-security-policy": `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    ...(IS_PRODUCTION ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {})
  };
}

function sendJson(res, status, payload, requestId, extraHeaders = {}) {
  res.writeHead(status, { ...securityHeaders(requestId), "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(value => value.trim()).filter(Boolean).map(value => {
    const separator = value.indexOf("=");
    return [decodeURIComponent(value.slice(0, separator)), decodeURIComponent(value.slice(separator + 1))];
  }));
}

function apiKeyMatches(req) {
  if (!API_KEY) return false;
  const supplied = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authenticate(req) {
  if (apiKeyMatches(req)) return { uuid: "integration", email: "integration@mwein.local", displayName: "System integration", initials: "API", role: "Admin" };
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const idleCutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000).toISOString();
  const row = db.prepare(`SELECT users.uuid, users.email, users.display_name, users.initials, users.role
    FROM sessions JOIN users ON users.uuid = sessions.user_uuid
    WHERE sessions.token = ? AND sessions.expires_at > ? AND sessions.last_seen_at > ? AND users.active = 1`).get(sessionTokenHash(token), now(), idleCutoff);
  if (!row) return null;
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token = ?").run(now(), sessionTokenHash(token));
  return { uuid: row.uuid, email: row.email, displayName: row.display_name, initials: row.initials, role: row.role };
}

function can(user, roles) {
  return user && (user.role === "Admin" || roles.includes(user.role));
}

function cookieHeader(req, token, maxAge) {
  const secure = IS_PRODUCTION || req.socket.encrypted || (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https");
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function requestOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    if (PUBLIC_ORIGIN) return new URL(origin).origin === new URL(PUBLIC_ORIGIN).origin;
    return new URL(origin).host === req.headers.host;
  }
  catch { return false; }
}

function requestHostAllowed(req) {
  if (!PUBLIC_ORIGIN) return true;
  try { return req.headers.host === new URL(PUBLIC_ORIGIN).host; }
  catch { return false; }
}

function isSecureRequest(req) {
  return Boolean(req.socket.encrypted || (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https"));
}

function loginRateLimited(req) {
  const forwarded = TRUST_PROXY ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  const key = forwarded || req.socket.remoteAddress || "unknown";
  const cutoff = Date.now() - 15 * 60 * 1000;
  const recent = (loginAttempts.get(key) || []).filter(timestamp => timestamp > cutoff);
  loginAttempts.set(key, recent);
  return { key, recent, limited: recent.length >= 10 };
}

async function readJson(req) {
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json"), { status: 415 });
  }
  if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") {
    throw Object.assign(new Error("Compressed request bodies are not accepted"), { status: 415 });
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON body"), { status: 400 }); }
}

function audit(actor, action, recordId, outcome, requestId) {
  const timestamp = now();
  const previousHash = db.prepare("SELECT event_hash FROM audit_events ORDER BY id DESC LIMIT 1").get()?.event_hash || "GENESIS";
  const digest = eventDigest(previousHash, timestamp, actor, action, recordId, outcome, requestId);
  db.prepare("INSERT INTO audit_events (occurred_at, actor, action, record_id, outcome, request_id, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(timestamp, actor, action, recordId, outcome, requestId, previousHash, digest);
}

function mapPatient(row) {
  return {
    uuid: row.uuid, id: row.identifier, name: row.name, phone: row.phone, sex: row.sex, age: row.age,
    county: row.county, subcounty: row.subcounty, residence: row.residence, kin: row.next_of_kin,
    program: row.program, consent: row.consent, summary: row.clinical_summary, risk: row.risk,
    last: row.updated_at === row.created_at ? "Registered" : new Date(row.updated_at).toLocaleDateString("en-KE")
  };
}

function validatePatient(body) {
  const patient = {
    id: text(body.id, 80), name: text(body.name, 120), phone: text(body.phone, 30), sex: text(body.sex, 20),
    age: Number(body.age), county: text(body.county, 80), subcounty: text(body.subcounty, 80),
    residence: text(body.residence, 160), kin: text(body.kin, 160), program: text(body.program, 80),
    consent: text(body.consent, 120), summary: text(body.summary, 2000)
  };
  if (!patient.id || !patient.name || !patient.phone || !patient.sex || !patient.county || !patient.consent || !Number.isInteger(patient.age) || patient.age < 0 || patient.age > 120) {
    throw Object.assign(new Error("Name, identifier, phone, sex, age, county, and consent are required"), { status: 422 });
  }
  return patient;
}

function prescriptionInput(body) {
  return {
    medicine: text(body.medicine, 160), dose: text(body.dose, 80), route: text(body.route || "Oral", 40),
    frequency: text(body.frequency, 80), duration: text(body.duration, 80), quantity: text(body.quantity, 40),
    instructions: text(body.instructions, 1000), reviewAcknowledged: body.reviewAcknowledged === true
  };
}

function screenPrescription(patientUuid, rx) {
  const patient = db.prepare("SELECT age, risk, clinical_summary FROM patients WHERE uuid = ?").get(patientUuid);
  if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
  const checks = [];
  const formularyItem = FORMULARY.find(item => item.medicine.toLowerCase() === rx.medicine.toLowerCase());
  if (!formularyItem) {
    checks.push({ pluginId: "facility-formulary", severity: "block", title: "Not in facility formulary", message: "Select an approved formulary medicine or request a governed formulary update." });
  } else if (formularyItem.stockStatus === "Out of stock") {
    checks.push({ pluginId: "facility-formulary", severity: "block", title: "Out of stock", message: `${formularyItem.medicine} is marked out of stock. Select an available alternative after clinical review.` });
  } else if (formularyItem.stockStatus === "Low") {
    checks.push({ pluginId: "facility-formulary", severity: "review", title: "Low stock", message: `${formularyItem.medicine} has ${formularyItem.stock} units remaining in the pilot stock ledger.` });
  } else {
    checks.push({ pluginId: "facility-formulary", severity: "pass", title: "Formulary and stock", message: `${formularyItem.medicine} is available in the facility formulary.` });
  }
  const allergyText = `${patient.risk || ""} ${patient.clinical_summary || ""}`;
  const betaLactam = /amoxicillin|penicillin|ampicillin|cloxacillin/i.test(rx.medicine);
  if (/penicillin|beta.?lactam/i.test(allergyText) && betaLactam) {
    checks.push({ pluginId: "allergy-guard", severity: "block", title: "Documented allergy conflict", message: "The patient record references a penicillin allergy. This order cannot be saved in the pilot workflow." });
  } else {
    checks.push({ pluginId: "allergy-guard", severity: "pass", title: "Allergy screen", message: "No matching allergy term was found in the currently documented patient summary." });
  }
  const duplicate = db.prepare("SELECT 1 FROM prescriptions WHERE patient_uuid = ? AND encounter_uuid IS NULL AND lower(medicine) = lower(?) LIMIT 1").get(patientUuid, rx.medicine);
  checks.push(duplicate
    ? { pluginId: "duplicate-therapy", severity: "block", title: "Duplicate unsigned order", message: "This medicine is already present in the current unsigned prescription list." }
    : { pluginId: "duplicate-therapy", severity: "pass", title: "Duplicate therapy", message: "No identical unsigned medicine order was found." });
  if (formularyItem?.antimicrobial) {
    checks.push({ pluginId: "antimicrobial-review", severity: "review", title: "Antimicrobial stewardship", message: "Confirm the indication, planned duration, and applicable approved facility guideline before saving." });
  } else {
    checks.push({ pluginId: "antimicrobial-review", severity: "pass", title: "Antimicrobial review", message: "The selected medicine is not classified as an antimicrobial in this pilot formulary." });
  }
  if (patient.age < 12) {
    checks.push({ pluginId: "paediatric-review", severity: "review", title: "Paediatric dose verification", message: "Verify weight, formulation, dose calculation, and maximum dose with an approved paediatric reference." });
  } else {
    checks.push({ pluginId: "paediatric-review", severity: "pass", title: "Age review", message: "No paediatric review trigger was detected." });
  }
  const overall = checks.some(check => check.severity === "block") ? "block" : checks.some(check => check.severity === "review") ? "review" : "pass";
  return { overall, checkedAt: now(), checks, disclaimer: "Advisory pilot screening only. A licensed clinician remains responsible for the prescription and must use approved clinical references." };
}

function openInvoice(patientUuid) {
  let invoice = db.prepare("SELECT * FROM invoices WHERE patient_uuid = ? AND status = 'Open' ORDER BY created_at DESC LIMIT 1").get(patientUuid);
  if (!invoice) {
    const timestamp = now();
    const uuid = randomUUID();
    db.prepare("INSERT INTO invoices (uuid, patient_uuid, status, created_at, updated_at) VALUES (?, ?, 'Open', ?, ?)").run(uuid, patientUuid, timestamp, timestamp);
    invoice = db.prepare("SELECT * FROM invoices WHERE uuid = ?").get(uuid);
  }
  return invoice;
}

function addInvoiceItem(patientUuid, sourceType, sourceUuid, description, quantity, unitPrice) {
  const invoice = openInvoice(patientUuid);
  db.prepare("INSERT INTO invoice_items (uuid, invoice_uuid, source_type, source_uuid, description, quantity, unit_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), invoice.uuid, sourceType, sourceUuid, description, quantity, unitPrice, now());
  db.prepare("UPDATE invoices SET updated_at = ? WHERE uuid = ?").run(now(), invoice.uuid);
}

function removeInvoiceItem(sourceUuid) {
  const item = db.prepare("SELECT invoice_uuid FROM invoice_items WHERE source_uuid = ?").get(sourceUuid);
  if (!item) return;
  db.prepare("DELETE FROM invoice_items WHERE source_uuid = ?").run(sourceUuid);
  const remaining = db.prepare("SELECT count(*) AS count FROM invoice_items WHERE invoice_uuid = ?").get(item.invoice_uuid).count;
  if (!remaining) db.prepare("DELETE FROM invoices WHERE uuid = ? AND status IN ('Open', 'Ready')").run(item.invoice_uuid);
  else db.prepare("UPDATE invoices SET updated_at = ? WHERE uuid = ?").run(now(), item.invoice_uuid);
}

function invoiceRows(patientUuid = "") {
  const invoices = patientUuid
    ? db.prepare(`SELECT i.*, p.name AS patient_name, p.identifier AS patient_identifier
        FROM invoices i JOIN patients p ON p.uuid = i.patient_uuid WHERE i.patient_uuid = ? ORDER BY i.created_at DESC`).all(patientUuid)
    : db.prepare(`SELECT i.*, p.name AS patient_name, p.identifier AS patient_identifier
        FROM invoices i JOIN patients p ON p.uuid = i.patient_uuid ORDER BY i.created_at DESC`).all();
  const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_uuid = ? ORDER BY created_at");
  return invoices.map(invoice => {
    const invoiceItems = items.all(invoice.uuid);
    return { ...invoice, items: invoiceItems, total: invoiceItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0) };
  });
}

function structuredLabResult(catalogItem, body) {
  const submitted = body.resultData && typeof body.resultData === "object" && !Array.isArray(body.resultData) ? body.resultData : {};
  const fields = [...catalogItem.resultFields, ...LAB_RESULT_COMMON_FIELDS];
  const values = {};
  for (const field of fields) {
    const value = text(submitted[field.id], field.type === "textarea" ? 2000 : 160);
    if (field.required && !value) throw Object.assign(new Error(`${field.label} is required to complete this result`), { status: 422 });
    if (value && field.type === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw Object.assign(new Error(`${field.label} must be numeric`), { status: 422 });
      if (field.min !== undefined && numeric < field.min || field.max !== undefined && numeric > field.max) throw Object.assign(new Error(`${field.label} is outside the accepted entry range`), { status: 422 });
    }
    if (value && field.type === "select" && !field.options.includes(value)) throw Object.assign(new Error(`${field.label} contains an invalid option`), { status: 422 });
    if (value) values[field.id] = value;
  }
  if (values.interpretation === "Critical" && !values.notes) throw Object.assign(new Error("Critical results require escalation details in Result notes"), { status: 422 });
  const labels = new Map(fields.map(field => [field.id, field]));
  const summary = Object.entries(values).map(([id, value]) => {
    const field = labels.get(id);
    return `${field.label}: ${value}${field.unit ? ` ${field.unit}` : ""}`;
  }).join("; ");
  return { values, summary };
}

function workflowState(patientUuid = "") {
  const patientFilter = patientUuid ? " AND o.patient_uuid = ?" : "";
  const labSql = `SELECT o.*, p.name AS patient_name, p.identifier AS patient_identifier FROM lab_orders o JOIN patients p ON p.uuid = o.patient_uuid WHERE 1 = 1${patientFilter} ORDER BY o.created_at DESC`;
  const pharmacySql = `SELECT r.*, p.name AS patient_name, p.identifier AS patient_identifier FROM prescriptions r JOIN patients p ON p.uuid = r.patient_uuid WHERE 1 = 1${patientUuid ? " AND r.patient_uuid = ?" : ""} ORDER BY r.created_at DESC`;
  const args = patientUuid ? [patientUuid] : [];
  const labOrders = db.prepare(labSql).all(...args);
  const pharmacyOrders = db.prepare(pharmacySql).all(...args);
  return {
    labCatalog: LAB_CATALOG,
    labResultCommonFields: LAB_RESULT_COMMON_FIELDS,
    labOrders,
    labWorklist: labOrders.filter(order => !["Complete", "Cancelled"].includes(order.status)),
    pharmacyOrders,
    pharmacyQueue: pharmacyOrders.filter(order => !["Dispensed", "Cancelled"].includes(order.status)),
    invoices: invoiceRows(patientUuid)
  };
}

function listAudit() {
  return db.prepare("SELECT occurred_at, actor, action, record_id, outcome FROM audit_events ORDER BY id DESC LIMIT 100").all()
    .map(row => [new Date(row.occurred_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }), row.actor, row.action, row.record_id, row.outcome]);
}

function kenyaDayWindow(daysAgo = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  const startMs = Date.UTC(parts.year, parts.month - 1, parts.day - daysAgo) - (3 * 60 * 60 * 1000);
  const start = new Date(startMs);
  const end = new Date(startMs + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString(), label: start.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", weekday: "short" }) };
}

function operationalMetrics() {
  const today = kenyaDayWindow();
  const countBetween = (table, extra = "", params = []) => db.prepare(
    `SELECT count(*) AS count FROM ${table} WHERE created_at >= ? AND created_at < ?${extra}`
  ).get(today.start, today.end, ...params).count;
  const totalPatients = db.prepare("SELECT count(*) AS count FROM patients").get().count;
  const totalEncounters = db.prepare("SELECT count(*) AS count FROM encounters").get().count;
  const missingNextOfKin = db.prepare("SELECT count(*) AS count FROM patients WHERE trim(next_of_kin) = ''").get().count;
  const missingDiagnosisCodes = db.prepare("SELECT count(*) AS count FROM encounters WHERE trim(diagnosis) = '' OR trim(icd10) = ''").get().count;
  const unsignedNotes = db.prepare("SELECT count(*) AS count FROM encounters WHERE status <> 'signed'").get().count;
  const qualityChecks = totalPatients + (totalEncounters * 2);
  const qualityGaps = missingNextOfKin + missingDiagnosisCodes + unsignedNotes;
  const visitsByDay = Array.from({ length: 7 }, (_, index) => kenyaDayWindow(6 - index)).map(day => ({
    label: day.label,
    count: db.prepare("SELECT count(*) AS count FROM encounters WHERE created_at >= ? AND created_at < ?").get(day.start, day.end).count
  }));
  const invoiceTotals = db.prepare(`SELECT
      count(DISTINCT CASE WHEN i.status = 'Open' THEN i.uuid END) AS open_count,
      count(DISTINCT CASE WHEN i.status = 'Ready' THEN i.uuid END) AS ready_count,
      coalesce(sum(CASE WHEN i.status = 'Open' THEN ii.quantity * ii.unit_price ELSE 0 END), 0) AS open_value,
      coalesce(sum(CASE WHEN i.status = 'Ready' THEN ii.quantity * ii.unit_price ELSE 0 END), 0) AS ready_value
    FROM invoices i LEFT JOIN invoice_items ii ON ii.invoice_uuid = i.uuid`).get();
  return {
    generatedAt: now(),
    demoMode: SEED_DEMO_DATA,
    patientsToday: countBetween("patients"),
    totalPatients,
    signedEncountersToday: countBetween("encounters", " AND status = ?", ["signed"]),
    openLabOrders: db.prepare("SELECT count(*) AS count FROM lab_orders WHERE status NOT IN ('Complete', 'Cancelled')").get().count,
    urgentLabOrders: db.prepare("SELECT count(*) AS count FROM lab_orders WHERE priority = 'Urgent' AND status NOT IN ('Complete', 'Cancelled')").get().count,
    completedLabsToday: db.prepare("SELECT count(*) AS count FROM lab_orders WHERE updated_at >= ? AND updated_at < ? AND status = 'Complete'").get(today.start, today.end).count,
    pharmacyQueue: db.prepare("SELECT count(*) AS count FROM prescriptions WHERE status NOT IN ('Dispensed', 'Cancelled')").get().count,
    dispensedPrescriptions: db.prepare("SELECT count(*) AS count FROM prescriptions WHERE status = 'Dispensed'").get().count,
    openInvoices: invoiceTotals.open_count,
    readyInvoices: invoiceTotals.ready_count,
    openInvoiceValue: invoiceTotals.open_value,
    readyInvoiceValue: invoiceTotals.ready_value,
    dataQuality: {
      score: qualityChecks ? Math.max(0, Math.round(((qualityChecks - qualityGaps) / qualityChecks) * 100)) : 0,
      missingDiagnosisCodes,
      missingNextOfKin,
      unsignedNotes
    },
    visitsByDay
  };
}

async function api(req, res, url, requestId) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { status: "ok", service: "mwein-emr-api", time: now() }, requestId);
  }
  if (req.method === "GET" && url.pathname === "/api/ready") {
    const database = db.prepare("PRAGMA quick_check").get();
    const auditIntegrity = verifyAuditChain();
    const ready = database.quick_check === "ok" && auditIntegrity && db.prepare("SELECT count(*) AS count FROM users WHERE active = 1").get().count > 0;
    return sendJson(res, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", database: database.quick_check, auditIntegrity, time: now() }, requestId);
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !requestOriginAllowed(req)) {
    return sendJson(res, 403, { error: "Request origin is not allowed" }, requestId);
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const rate = loginRateLimited(req);
    if (rate.limited) return sendJson(res, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." }, requestId);
    const body = await readJson(req);
    const email = text(body.email, 160).toLowerCase();
    const password = String(body.password || "");
    if (password.length > 256) return sendJson(res, 401, { error: "The email or password is incorrect" }, requestId);
    const user = db.prepare("SELECT * FROM users WHERE lower(email) = ? AND active = 1").get(email);
    const candidate = user ? passwordHash(password, user.password_salt) : passwordHash(password, "invalid-user-salt");
    const expected = user?.password_hash || "0".repeat(128);
    const valid = candidate.length === expected.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
    if (!valid) {
      rate.recent.push(Date.now());
      loginAttempts.set(rate.key, rate.recent);
      audit("ANON", "Sign-in failed", email || "unknown", "Denied", requestId);
      return sendJson(res, 401, { error: "The email or password is incorrect" }, requestId);
    }
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
    loginAttempts.delete(rate.key);
    const timestamp = now();
    db.prepare("INSERT INTO sessions (token, user_uuid, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(sessionTokenHash(token), user.uuid, expiresAt, timestamp, timestamp);
    audit(user.initials, "Staff signed in", user.uuid, "Allowed", requestId);
    return sendJson(res, 200, { user: { uuid: user.uuid, email: user.email, displayName: user.display_name, initials: user.initials, role: user.role }, expiresAt }, requestId, { "set-cookie": cookieHeader(req, token, SESSION_HOURS * 60 * 60) });
  }
  const authenticatedUser = authenticate(req);
  if (!authenticatedUser) return sendJson(res, 401, { error: "Authentication required", requestId }, requestId);
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(sessionTokenHash(token));
    audit(authenticatedUser.initials, "Staff signed out", authenticatedUser.uuid, "Allowed", requestId);
    return sendJson(res, 200, { ok: true }, requestId, { "set-cookie": cookieHeader(req, "", 0) });
  }
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    return sendJson(res, 200, { user: authenticatedUser }, requestId);
  }
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const patients = db.prepare("SELECT * FROM patients ORDER BY updated_at DESC, name").all().map(mapPatient);
    return sendJson(res, 200, { patients, audit: listAudit(), user: authenticatedUser, prescriptionPlugins: PRESCRIPTION_PLUGINS, formulary: FORMULARY, workflow: workflowState(), metrics: operationalMetrics(), serverTime: now() }, requestId);
  }
  if (req.method === "GET" && url.pathname === "/api/metrics") {
    return sendJson(res, 200, { metrics: operationalMetrics() }, requestId);
  }
  if (req.method === "GET" && url.pathname === "/api/prescription-plugins") {
    return sendJson(res, 200, { plugins: PRESCRIPTION_PLUGINS, formulary: FORMULARY }, requestId);
  }
  if (req.method === "GET" && url.pathname === "/api/workflow") {
    return sendJson(res, 200, { workflow: workflowState() }, requestId);
  }
  if (req.method === "POST" && url.pathname === "/api/prescriptions/screen") {
    if (!can(authenticatedUser, ["Clinician"])) return sendJson(res, 403, { error: "Only clinicians can screen prescriptions" }, requestId);
    const body = await readJson(req);
    const patientUuid = text(body.patientUuid, 80);
    const rx = prescriptionInput(body);
    if (!patientUuid || !rx.medicine || !rx.dose || !rx.frequency || !rx.duration) return sendJson(res, 422, { error: "Patient, medicine, dose, frequency, and duration are required" }, requestId);
    return sendJson(res, 200, { screening: screenPrescription(patientUuid, rx) }, requestId);
  }
  if (req.method === "POST" && url.pathname === "/api/patients") {
    if (!can(authenticatedUser, ["Clinician", "Nurse"])) return sendJson(res, 403, { error: "Your role cannot register patients" }, requestId);
    const patient = validatePatient(await readJson(req));
    const duplicate = db.prepare("SELECT uuid, identifier FROM patients WHERE lower(identifier) = lower(?) OR phone = ? LIMIT 1").get(patient.id, patient.phone);
    if (duplicate) return sendJson(res, 409, { error: "A patient with this identifier or phone already exists", duplicate }, requestId);
    const uuid = randomUUID();
    const timestamp = now();
    const risk = /pending/i.test(patient.consent) ? "Consent pending" : "New";
    db.prepare(`INSERT INTO patients (uuid, identifier, name, phone, sex, age, county, subcounty, residence, next_of_kin, program, consent, clinical_summary, risk, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uuid, patient.id, patient.name, patient.phone, patient.sex, patient.age, patient.county, patient.subcounty, patient.residence, patient.kin, patient.program, patient.consent, patient.summary, risk, timestamp, timestamp);
    audit(authenticatedUser.initials, "Client registered", patient.id, "Recorded", requestId);
    const created = db.prepare("SELECT * FROM patients WHERE uuid = ?").get(uuid);
    return sendJson(res, 201, { patient: mapPatient(created), audit: listAudit() }, requestId);
  }
  const prescriptionMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/prescriptions$/);
  if (req.method === "GET" && prescriptionMatch) {
    const rows = db.prepare("SELECT * FROM prescriptions WHERE patient_uuid = ? AND encounter_uuid IS NULL ORDER BY created_at").all(decodeURIComponent(prescriptionMatch[1]));
    return sendJson(res, 200, { prescriptions: rows }, requestId);
  }
  if (req.method === "POST" && prescriptionMatch) {
    if (!can(authenticatedUser, ["Clinician"])) return sendJson(res, 403, { error: "Only clinicians can prescribe medicines" }, requestId);
    const patientUuid = decodeURIComponent(prescriptionMatch[1]);
    if (!db.prepare("SELECT 1 FROM patients WHERE uuid = ?").get(patientUuid)) return sendJson(res, 404, { error: "Patient not found" }, requestId);
    const body = await readJson(req);
    const rx = prescriptionInput(body);
    if (!rx.medicine || !rx.dose || !rx.frequency || !rx.duration) throw Object.assign(new Error("Medicine, dose, frequency, and duration are required"), { status: 422 });
    const screening = screenPrescription(patientUuid, rx);
    if (screening.overall === "block") return sendJson(res, 422, { error: "Prescription blocked by a mandatory safety plug-in", screening }, requestId);
    if (screening.overall === "review" && !rx.reviewAcknowledged) return sendJson(res, 422, { error: "Acknowledge the clinical review items before saving", screening }, requestId);
    const status = "Ready";
    const uuid = randomUUID();
    const formularyItem = FORMULARY.find(item => item.medicine.toLowerCase() === rx.medicine.toLowerCase());
    const quantity = Math.max(1, Number.parseInt(rx.quantity, 10) || 1);
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO prescriptions (uuid, patient_uuid, medicine, dose, route, frequency, duration, quantity, instructions, status, screening_status, screening_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(uuid, patientUuid, rx.medicine, rx.dose, rx.route, rx.frequency, rx.duration, rx.quantity, rx.instructions, status, screening.overall, JSON.stringify(screening), now());
      addInvoiceItem(patientUuid, "prescription", uuid, rx.medicine, quantity, formularyItem?.unitPrice || 0);
      audit(authenticatedUser.initials, "Prescription added", rx.medicine, `Screening ${screening.overall}; invoiced`, requestId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return sendJson(res, 201, { prescription: db.prepare("SELECT * FROM prescriptions WHERE uuid = ?").get(uuid), workflow: workflowState(patientUuid), audit: listAudit() }, requestId);
  }
  const prescriptionStatusMatch = url.pathname.match(/^\/api\/prescriptions\/([^/]+)\/status$/);
  if (req.method === "PATCH" && prescriptionStatusMatch) {
    if (!can(authenticatedUser, ["Clinician", "Pharmacy"])) return sendJson(res, 403, { error: "Only pharmacy or clinical staff can update dispensing" }, requestId);
    const uuid = decodeURIComponent(prescriptionStatusMatch[1]);
    const rx = db.prepare("SELECT patient_uuid, medicine, status FROM prescriptions WHERE uuid = ?").get(uuid);
    if (!rx) return sendJson(res, 404, { error: "Prescription not found" }, requestId);
    const status = text((await readJson(req)).status, 30);
    if (!["Ready", "Dispensed"].includes(status)) return sendJson(res, 422, { error: "Prescription status must be Ready or Dispensed" }, requestId);
    db.prepare("UPDATE prescriptions SET status = ? WHERE uuid = ?").run(status, uuid);
    audit(authenticatedUser.initials, "Dispensing status updated", rx.medicine, status, requestId);
    return sendJson(res, 200, { workflow: workflowState(rx.patient_uuid), audit: listAudit() }, requestId);
  }
  const deleteRxMatch = url.pathname.match(/^\/api\/prescriptions\/([^/]+)$/);
  if (req.method === "DELETE" && deleteRxMatch) {
    if (!can(authenticatedUser, ["Clinician"])) return sendJson(res, 403, { error: "Only clinicians can change prescriptions" }, requestId);
    const uuid = decodeURIComponent(deleteRxMatch[1]);
    const rx = db.prepare("SELECT patient_uuid, medicine, status, encounter_uuid FROM prescriptions WHERE uuid = ?").get(uuid);
    if (!rx) return sendJson(res, 404, { error: "Prescription not found" }, requestId);
    if (rx.encounter_uuid) return sendJson(res, 409, { error: "A prescription attached to a signed encounter cannot be deleted" }, requestId);
    if (rx.status === "Dispensed") return sendJson(res, 409, { error: "A dispensed prescription cannot be deleted; use the governed returns workflow" }, requestId);
    db.exec("BEGIN");
    try {
      removeInvoiceItem(uuid);
      db.prepare("DELETE FROM prescriptions WHERE uuid = ?").run(uuid);
      audit(authenticatedUser.initials, "Prescription removed", rx.medicine, "Invoice line removed", requestId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return sendJson(res, 200, { ok: true, workflow: workflowState(rx.patient_uuid), audit: listAudit() }, requestId);
  }
  const patientWorkflowMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/workflow$/);
  if (req.method === "GET" && patientWorkflowMatch) {
    const patientUuid = decodeURIComponent(patientWorkflowMatch[1]);
    if (!db.prepare("SELECT 1 FROM patients WHERE uuid = ?").get(patientUuid)) return sendJson(res, 404, { error: "Patient not found" }, requestId);
    return sendJson(res, 200, { workflow: workflowState(patientUuid) }, requestId);
  }
  const patientLabMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/lab-orders$/);
  if (req.method === "POST" && patientLabMatch) {
    if (!can(authenticatedUser, ["Clinician"])) return sendJson(res, 403, { error: "Only clinicians can order laboratory tests" }, requestId);
    const patientUuid = decodeURIComponent(patientLabMatch[1]);
    if (!db.prepare("SELECT 1 FROM patients WHERE uuid = ?").get(patientUuid)) return sendJson(res, 404, { error: "Patient not found" }, requestId);
    const body = await readJson(req);
    const testName = text(body.testName, 120);
    const priority = text(body.priority || "Routine", 30);
    const catalogItem = LAB_CATALOG.find(item => item.test.toLowerCase() === testName.toLowerCase());
    if (!catalogItem || !["Routine", "Urgent"].includes(priority)) return sendJson(res, 422, { error: "Select a valid laboratory test and priority" }, requestId);
    const duplicate = db.prepare("SELECT 1 FROM lab_orders WHERE patient_uuid = ? AND encounter_uuid IS NULL AND lower(test_name) = lower(?) AND status != 'Cancelled'").get(patientUuid, testName);
    if (duplicate) return sendJson(res, 409, { error: "This test is already ordered for the current visit" }, requestId);
    const uuid = randomUUID();
    const timestamp = now();
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO lab_orders (uuid, patient_uuid, test_name, specimen, priority, status, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Ordered', ?, ?, ?)")
        .run(uuid, patientUuid, catalogItem.test, catalogItem.specimen, priority, catalogItem.price, timestamp, timestamp);
      addInvoiceItem(patientUuid, "lab", uuid, catalogItem.test, 1, catalogItem.price);
      audit(authenticatedUser.initials, "Lab test ordered", catalogItem.test, "Invoice line added", requestId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return sendJson(res, 201, { order: db.prepare("SELECT * FROM lab_orders WHERE uuid = ?").get(uuid), workflow: workflowState(patientUuid), audit: listAudit() }, requestId);
  }
  const labStatusMatch = url.pathname.match(/^\/api\/lab-orders\/([^/]+)\/status$/);
  if (req.method === "PATCH" && labStatusMatch) {
    if (!can(authenticatedUser, ["Clinician", "Lab"])) return sendJson(res, 403, { error: "Only laboratory or clinical staff can update test status" }, requestId);
    const uuid = decodeURIComponent(labStatusMatch[1]);
    const order = db.prepare("SELECT patient_uuid, test_name, status, result, result_json FROM lab_orders WHERE uuid = ?").get(uuid);
    if (!order) return sendJson(res, 404, { error: "Lab order not found" }, requestId);
    const body = await readJson(req);
    const status = text(body.status, 30);
    if (!["Ordered", "Collected", "Processing", "Complete", "Cancelled"].includes(status)) return sendJson(res, 422, { error: "Invalid laboratory status" }, requestId);
    const catalogItem = LAB_CATALOG.find(item => item.test === order.test_name);
    if (!catalogItem) return sendJson(res, 422, { error: "The laboratory result schema is unavailable" }, requestId);
    const structured = status === "Complete" ? structuredLabResult(catalogItem, body) : null;
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE lab_orders SET status = ?, result = ?, result_json = ?, updated_at = ? WHERE uuid = ?")
        .run(status, structured?.summary || order.result, structured ? JSON.stringify(structured.values) : order.result_json, now(), uuid);
      if (status === "Cancelled") removeInvoiceItem(uuid);
      audit(authenticatedUser.initials, "Lab status updated", order.test_name, status === "Cancelled" ? "Cancelled; invoice line removed" : status, requestId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return sendJson(res, 200, { workflow: workflowState(order.patient_uuid), audit: listAudit() }, requestId);
  }
  if (req.method === "POST" && url.pathname === "/api/encounters") {
    if (!can(authenticatedUser, ["Clinician"])) return sendJson(res, 403, { error: "Only clinicians can sign encounters" }, requestId);
    const body = await readJson(req);
    const patientUuid = text(body.patientUuid, 80);
    if (!db.prepare("SELECT 1 FROM patients WHERE uuid = ?").get(patientUuid)) return sendJson(res, 404, { error: "Patient not found" }, requestId);
    const uuid = randomUUID();
    const timestamp = now();
    db.exec("BEGIN");
    try {
      db.prepare(`INSERT INTO encounters (uuid, patient_uuid, status, encounter_type, priority, department, vitals_json, subjective, objective, diagnosis, icd10, plan, follow_up, disposition, summary, clinician, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uuid, patientUuid, "signed", text(body.encounterType || "Outpatient", 60), text(body.priority || "Routine", 40), text(body.department || "General outpatient", 80), JSON.stringify(body.vitals || {}), text(body.subjective, 5000), text(body.objective, 5000), text(body.diagnosis, 500), text(body.icd10, 30), text(body.plan, 5000), text(body.followUp, 500), text(body.disposition || "Home", 80), text(body.summary, 12000), authenticatedUser.displayName, timestamp, timestamp);
      db.prepare("UPDATE prescriptions SET encounter_uuid = ? WHERE patient_uuid = ? AND encounter_uuid IS NULL").run(uuid, patientUuid);
      db.prepare("UPDATE lab_orders SET encounter_uuid = ?, updated_at = ? WHERE patient_uuid = ? AND encounter_uuid IS NULL").run(uuid, timestamp, patientUuid);
      db.prepare("UPDATE invoices SET encounter_uuid = ?, status = 'Ready', updated_at = ? WHERE patient_uuid = ? AND status = 'Open'").run(uuid, timestamp, patientUuid);
      db.prepare("UPDATE patients SET updated_at = ? WHERE uuid = ?").run(timestamp, patientUuid);
      audit(authenticatedUser.initials, "Encounter signed", uuid, "Recorded", requestId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return sendJson(res, 201, { encounter: { uuid, status: "signed", createdAt: timestamp }, audit: listAudit() }, requestId);
  }
  return sendJson(res, 404, { error: "API route not found", requestId }, requestId);
}

async function serveStatic(req, res, url, requestId) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const relative = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const publicFiles = new Set(["index.html", "manifest.webmanifest", "service-worker.js", "robots.txt", "health.json"]);
  if (!publicFiles.has(relative)) return sendJson(res, 404, { error: "Not found", requestId }, requestId);
  const path = join(ROOT, relative);
  if (!path.startsWith(ROOT) || !existsSync(path)) return sendJson(res, 404, { error: "Not found", requestId }, requestId);
  let body = await readFile(path);
  const nonce = randomBytes(18).toString("base64");
  if (extname(path) === ".html") body = Buffer.from(body.toString("utf8").replaceAll("__CSP_NONCE__", nonce));
  res.writeHead(200, { ...securityHeaders(requestId, nonce), "content-type": mimeTypes[extname(path)] || "application/octet-stream", "cache-control": extname(path) === ".html" ? "no-store" : "public, max-age=300" });
  res.end(req.method === "HEAD" ? undefined : body);
}

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  if ((req.url || "").length > 2048) return sendJson(res, 414, { error: "Request URL is too long", requestId }, requestId);
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname !== "/api/health" && !requestHostAllowed(req)) return sendJson(res, 421, { error: "Misdirected request", requestId }, requestId);
    if (IS_PRODUCTION && !isSecureRequest(req) && url.pathname !== "/api/health") return sendJson(res, 426, { error: "HTTPS is required", requestId }, requestId);
    if (url.pathname.startsWith("/api/")) await api(req, res, url, requestId);
    else if (req.method === "GET" || req.method === "HEAD") await serveStatic(req, res, url, requestId);
    else sendJson(res, 405, { error: "Method not allowed", requestId }, requestId);
  } catch (error) {
    console.error(`[${requestId}]`, error);
    sendJson(res, error.status || 500, { error: error.status ? error.message : "Internal server error", requestId }, requestId);
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.listen(PORT, HOST, () => console.log(`Mwein EMR listening on http://${HOST}:${PORT}`));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    const forcedShutdown = setTimeout(() => {
      server.closeAllConnections();
      db.close();
      process.exit(1);
    }, 10_000).unref();
    server.close(() => {
      clearTimeout(forcedShutdown);
      db.close();
      process.exit(0);
    });
  });
}
