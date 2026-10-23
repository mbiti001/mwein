# Production Readiness Gate

Mwein Cloud EMR is a hardened deployment candidate. It is not authorized for real patient data until every external and operational gate below has an accountable owner, evidence, approval date, and review date.

## Enforced In This Repository

- Production fails closed without an HTTPS `PUBLIC_ORIGIN` and a strong first-user password.
- Demo patient seeding is disabled and rejected in production.
- Passwords use salted scrypt hashes; random session tokens are hashed at rest.
- Sessions have 30-minute idle and 8-hour absolute expiry by default.
- Production cookies are `Secure`, `HttpOnly`, `SameSite=Strict`, and use the `__Host-` prefix.
- Server-side roles authorize registration, prescribing, and encounter signing.
- Prescription saves enforce server-owned formulary, allergy, duplicate-order, antimicrobial, and paediatric review plug-ins.
- Laboratory and prescription orders synchronize transactionally with invoices; cancellations reverse charges and completed work leaves active queues without deleting billing history.
- Laboratory completion uses server-validated, test-specific result schemas with universal specimen-quality, interpretation, method, reference-context, and notes fields.
- Cross-origin writes, invalid hosts, insecure production traffic, oversized JSON, and excessive login attempts are rejected.
- CSP nonces prevent arbitrary inline script execution; security and HSTS headers are emitted.
- Only explicit public assets are downloadable. Application source and database paths return 404.
- SQLite uses WAL, foreign keys, a busy timeout, transactional encounter signing, and integrity-aware readiness.
- Audit events form a SHA-256 hash chain checked by `/api/ready`.
- `npm run backup` creates a SQLite-consistent backup, verifies integrity, and restricts file permissions.
- `npm run verify-backup` exercises an isolated writable restore copy, required schemas, and audit-chain continuity.
- CI runs syntax checks, API tests, restore verification, and a hardened container build; `.dockerignore` excludes local data and secrets from the build context.
- The production Compose profile runs as non-root, drops Linux capabilities, uses a read-only root filesystem, and mounts persistent data separately.

## Mandatory Before Patient Use

| Gate | Required evidence | Status |
|---|---|---|
| Clinical governance | Named clinical safety officer, hazard log, governed plug-in sources and versions, medication-rule validation, override policy, signed UAT | Open |
| Identity | Managed identity provider, MFA, joiner/mover/leaver process, quarterly access review | Open |
| Data protection | Approved DPIA, ODPC controller/processor registration, lawful-basis and consent records | Open |
| Hosting | Kenya-approved data-location decision, encryption-at-rest evidence, key rotation, network diagram | Open |
| Resilience | Automated encrypted off-site backups and documented restore drill meeting RPO/RTO | Open |
| Security assurance | Threat model, dependency/container scanning, SAST/DAST, independent penetration test | Open |
| Incident response | On-call ownership, breach assessment workflow, evidence preservation, notification templates | Open |
| Digital health | DHA certification/interoperability evidence and approved production integration credentials | Open |
| Operations | Monitoring, alerting, capacity test, patch SLA, change approvals, downtime procedure | Open |
| Data lifecycle | Retention schedule, patient access/correction/export workflow, deletion/legal-hold procedure | Open |

## Kenyan Compliance Context

The ODPC identifies health information as sensitive and calls for technical and organizational safeguards, including access controls and encryption. Its health-data guidance also describes breach reporting to the ODPC within 72 hours and communication to affected data subjects where required. High-risk processing requires a DPIA before processing begins.

Use the current primary guidance during sign-off:

- [ODPC guidance library](https://www.odpc.go.ke/guidelines-2/)
- [ODPC Guidance Note on Processing of Health Data](https://www.odpc.go.ke/wp-content/uploads/2024/02/ODPC-Guidance-Note-on-Processing-of-Health-Data.pdf)
- [ODPC Guidance Note on Data Protection Impact Assessment](https://www.odpc.go.ke/wp-content/uploads/2024/02/ODPC-Guidance-Note-on-Data-Protection-Impact-Assessment-1.pdf)
- [Kenya Ministry of Health digital-health regulations update](https://www.health.go.ke/cs-duale-reviews-digital-health-regulations-national-assembly-committee)
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)

Regulatory interpretation and certification decisions must be confirmed with Kenyan legal, privacy, clinical, and Digital Health Agency specialists.
