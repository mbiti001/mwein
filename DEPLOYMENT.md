# Deployment Guide

This repository contains a deployable full-stack pilot: a Node HTTP service, browser PWA, and persistent SQLite clinical store. It is not yet approved for real patient data.

## Local Service

Requires Node.js 22.5 or newer.

```bash
npm test
npm start
```

Open `http://127.0.0.1:4173`. The API health endpoint is `/api/health` and the database is created under `data/`.

## Docker

Build and run locally:

```bash
docker build -t mwein-emr .
docker run --rm -p 8080:8080 \
  -v mwein-data:/app/data \
  -e NODE_ENV=development \
  -e EMR_BOOTSTRAP_PASSWORD='replace-with-a-strong-secret' \
  mwein-emr
```

Open `http://127.0.0.1:8080`.

The direct command is for local container testing only. Production mode intentionally refuses plain HTTP.

For a hardened baseline, create `secrets/emr_bootstrap_password.txt`, set `PUBLIC_ORIGIN` to the public HTTPS URL, and run:

```bash
PUBLIC_ORIGIN=https://emr.example.ke docker compose -f compose.production.yml up -d --build
```

Use a named volume or encrypted persistent disk. A container without `/app/data` persistence will lose clinical records when removed.

## Reverse Proxy

Put the Node service behind an HTTPS reverse proxy or managed load balancer. Forward `/api/*`, the PWA files, and Web requests to the same service origin. Disable proxy caching for `/api/*` and `service-worker.js`.

Set `HOST=0.0.0.0`, choose `PORT`, mount `DATA_DIR`, set the exact HTTPS `PUBLIC_ORIGIN`, and provide `EMR_BOOTSTRAP_PASSWORD_FILE` through a secret manager on first startup. Set `TRUST_PROXY=true` only when the proxy overwrites incoming forwarding headers. Staff sessions use host-bound secure cookies, a 30-minute idle timeout, and an eight-hour absolute timeout. `EMR_API_KEY` is reserved for trusted machine integrations and must never be placed in browser storage.

## Backup

SQLite runs in WAL mode. Run `npm run backup` for a consistent, integrity-checked local snapshot. Encrypt and copy backups to a separate security boundary, apply retention rules, and test restoration to a separate environment against documented recovery-point and recovery-time targets.

Run `npm run verify-backup` as a scheduled restore drill. It tests the newest local backup by default; use `BACKUP_PATH=/secure/path/backup.sqlite npm run verify-backup` for a selected off-site copy. Successful verification does not replace a periodic full application recovery exercise.

Use `/api/health` for liveness and `/api/ready` for readiness. Readiness verifies SQLite and the audit hash chain.

## Production Gate

Before real patient use, add:

- Replace local staff accounts with identity-provider MFA, provisioning, suspension, and access review
- Managed encrypted database, encrypted backups, and tested restoration
- Facility tenancy and role-based authorization
- Append-only external audit retention and alerting
- Data retention policy enforcement
- SHA integration credentials and validation
- FHIR-compatible exchange layer
- Penetration testing and vulnerability management
- DPIA sign-off and ODPC operational documentation
- Clinical safety review and user acceptance testing

Track approvals and evidence in `PRODUCTION_READINESS.md`.
