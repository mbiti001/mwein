# Cloud Deployment Checklist

This project is packaged for container deployment, but it is not authorized for real patient information until every mandatory gate in `PRODUCTION_READINESS.md` is approved with evidence.

## 1. Open And Verify

1. Open `Mwein-Cloud-EMR.code-workspace` in VS Code.
2. Use **Terminal > Run Task > EMR: Run tests**.
3. Use **EMR: Start local server** and verify `/api/health` and `/api/ready`.
4. Use **EMR: Build cloud source bundle** to create the allowlisted archive under `dist/`.
5. Review `GITHUB_PREPARATION.md` before the first branch push or pull request.

## 2. Provision Cloud Infrastructure

- Choose an approved hosting region and document the Kenyan health-data location decision.
- Provision HTTPS ingress, an encrypted persistent volume, private networking, logging, monitoring, and a secret manager.
- Do not expose the Node container port directly to the public internet.
- Disable caching for `/api/*` and `service-worker.js` at the proxy or CDN.
- Restrict administrator and backup access through least-privilege identities.

## 3. Configure Secrets

Copy `.env.example` to the deployment platform's environment configuration and replace every example value. Never commit `.env`, the `secrets/` directory, database files, or backup files.

Required production values:

- `PUBLIC_ORIGIN`: exact public HTTPS origin, such as `https://emr.facility.example`.
- `EMR_BOOTSTRAP_PASSWORD_FILE`: secret-mounted initial account password with at least 16 characters.
- `DATA_DIR`: path on the encrypted persistent volume.
- `TRUST_PROXY=true`: only when the trusted ingress overwrites forwarded headers.
- `SEED_DEMO_DATA=false`: mandatory in production.

## 4. Validate The Container

```bash
PUBLIC_ORIGIN=https://emr.facility.example \
  docker compose -f compose.production.yml config

PUBLIC_ORIGIN=https://emr.facility.example \
  docker compose -f compose.production.yml up -d --build
```

Verify liveness and readiness through the HTTPS ingress. Confirm that insecure traffic, unexpected hosts, cross-origin writes, source files, database paths, and demo seeding are rejected.

## 5. Recovery And Release Evidence

1. Run an encrypted off-site backup.
2. Run `BACKUP_PATH=/secure/backup.sqlite npm run verify-backup` in an isolated recovery environment.
3. Complete a full application restore drill and record RPO/RTO evidence.
4. Run security scanning and an independent penetration test.
5. Obtain clinical rule validation, signed UAT, DPIA approval, identity/MFA evidence, incident procedures, and applicable DHA/ODPC approvals.
6. Record release owner, image digest, configuration version, approval date, rollback image, and monitoring links.

Do not treat a successful container deployment as authorization to process real patient data.
