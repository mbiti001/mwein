# Mwein Cloud EMR

Mwein Cloud EMR is a Kenya-focused full-stack electronic medical record pilot for outpatient and primary care facilities. It includes patient registration, encounter documentation, prescription capture, visit summaries, lab and pharmacy workflows, SHA billing preparation, analytics, audit logging, and compliance readiness.

## What Is Included

- Single-page clinical workspace in `index.html`
- Node clinical API in `server.js`
- Persistent SQLite database created at `data/mwein-emr.sqlite`
- Transactional encounters, prescriptions, server-side safety screening, health monitoring, and audit events
- Governed prescription plug-ins for facility formulary, stock, allergy, duplicate-order, antimicrobial, and paediatric review
- Synchronized lab, dispensing, and invoice lifecycle: ordering creates a charge, cancellation or deletion reverses it, and completion or dispensing clears the active queue while preserving the charge
- Staff sign-in with salted password hashing, expiring HTTP-only sessions, and server-enforced clinical roles
- Fail-closed production configuration, CSP nonces, host/origin enforcement, tamper-evident audit chaining, and verified backups
- Installable PWA metadata in `manifest.webmanifest`
- Offline app-shell cache in `service-worker.js`
- Implementation and rollout plan in `EMR_IMPLEMENTATION_PLAN.md`
- Deployment guide in `DEPLOYMENT.md`
- Cloud release checklist in `CLOUD_DEPLOY_CHECKLIST.md`
- GitHub connection and safe first-push guide in `GITHUB_PREPARATION.md`
- Security notes in `SECURITY.md`
- Production gate and evidence checklist in `PRODUCTION_READINESS.md`
- Docker, Nginx, Apache/cPanel, health check, and robots metadata

## Demo Workflow

1. Open the dashboard and review cloud readiness, clinical safety, triage queue, and workflow cards.
2. Go to Patients and test duplicate detection by entering `CHU-4481-029`.
3. Open Peter Wekesa from the registry and confirm the encounter profile updates.
4. Use the Safety tab to tick checklist items and watch the completion score change.
5. In the Orders tab, complete a prescription, run the safety plug-ins, and review pass, review, or blocked findings before saving.
6. Open Visit Summary, generate the visit note, then copy, download, or print it.
7. Open Analytics to review charts, report pack, and assessment rubric.
8. Use the download icon in the top bar to export a sample daily JSON report.
9. Open Compliance to review architecture, ODPC posture, exchange readiness, and audit logs.

## Run Locally

Requires Node.js 22.5 or newer.

```bash
npm start
```

Then open `http://127.0.0.1:4173/index.html`.

## Open In VS Code

Open `Mwein-Cloud-EMR.code-workspace` in VS Code. The workspace includes tasks for starting the server, running tests, creating and verifying backups, and producing an allowlisted cloud source bundle.

Run `npm run package-release` to create `dist/mwein-cloud-emr-v<version>.zip`. The archive excludes local databases, backups, secrets, environment files, unrelated website files, and development output.

## Docker Deployment

```bash
docker build -t mwein-emr .
docker run --rm -p 8080:8080 -v mwein-data:/app/data \
  -e NODE_ENV=development \
  -e EMR_BOOTSTRAP_PASSWORD='replace-with-a-strong-secret' mwein-emr
```

Then open `http://127.0.0.1:8080`.

This command is only for local container testing. Use `compose.production.yml` behind an HTTPS reverse proxy for the hardened baseline.

## Configuration

- `PORT`: HTTP port, defaults to `4173`
- `HOST`: bind host, defaults to `127.0.0.1`
- `DATA_DIR`: persistent SQLite directory, defaults to `./data`
- `DATABASE_PATH`: optional full SQLite file path
- `EMR_BOOTSTRAP_PASSWORD`: required on first production startup; creates `clinician@mwein.local`
- `PUBLIC_ORIGIN`: required HTTPS application origin in production
- `TRUST_PROXY`: set to `true` only behind a trusted reverse proxy that overwrites forwarding headers
- `SESSION_HOURS` and `SESSION_IDLE_MINUTES`: absolute and idle session limits
- `SEED_DEMO_DATA`: defaults to false and is rejected in production
- `EMR_API_KEY`: optional bearer token for trusted machine integrations

Local development seeds `clinician@mwein.local` with password `MweinPilot2026!`. Change the bootstrap password for every deployed environment.

Run `npm test` to verify the database-backed registration and encounter flow.

Run `npm run backup` to create and integrity-check a restricted backup under `data/backups/`. Production must copy encrypted backups off-host and test restoration regularly.

Run `npm run verify-backup` to copy the newest backup into an isolated temporary restore location, verify SQLite integrity, required tables, audit-chain continuity, and a writable transaction, then remove the temporary copy. Set `BACKUP_PATH` to test a specific backup.

## Prescription Safety Plug-ins

Prescription plug-ins are an allowlisted, server-owned clinical decision-support layer. The browser can display results but cannot bypass mandatory server screening when an order is saved. The current pilot checks facility formulary and stock flags, documented penicillin-allergy terms, identical unsigned orders, antimicrobial review, and paediatric review.

The rules and sample stock values are demonstration data, not authoritative clinical content. Before patient use, a named clinical safety owner must approve rule sources, medicine identifiers, terminology mappings, dose logic, stock integration, override policy, versioning, validation cases, monitoring, and rollback. Do not load arbitrary third-party plug-in code into the clinical process.

## Orders And Billing

Laboratory orders and prescriptions create invoice items in the same database transaction as the clinical order. Cancelling an unfinished lab order or deleting an unsigned, undispensed prescription removes its invoice line. Completing a lab test or dispensing a prescription removes it from the active operational queue but retains the charge and audit history. Signing an encounter links its orders and marks the open invoice ready for billing review.

Catalog prices are integer KES pilot values stored in server configuration. They are not approved tariffs and must be replaced with facility-governed service and medicine pricing before deployment.

## Structured Laboratory Results

Each laboratory catalog item defines its own controlled result schema. Malaria and pregnancy tests use qualitative outcomes; FBC, glucose, and HbA1c capture numeric analytes and units; urinalysis captures a structured dipstick panel. Every test also records specimen quality, overall interpretation, optional method/analyser, reference context, and universal result notes.

The server validates required fields, numeric values, and controlled options before a result can be completed. Completed results leave the active worklist while remaining linked to the encounter, invoice, and audit history. The pilot fields and reference context require approval by the facility laboratory lead before patient use.

## Production Path

This version is an engineering pilot, not yet a certified medical device or production clinical system. Before real patient use, replace the bootstrap account with identity-provider MFA and account lifecycle management, then add managed encrypted database hosting, facility tenancy, tested offline conflict resolution, secrets management, backups and restore drills, validated prescription knowledge sources, SHA integration, FHIR exchange validation, monitoring, penetration testing, a DPIA, and Kenyan digital health certification evidence.
