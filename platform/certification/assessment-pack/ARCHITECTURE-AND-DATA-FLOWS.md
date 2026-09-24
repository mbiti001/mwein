# Architecture and data flows

Describes the committed release; provider region, physical residency, contractual access and encryption configuration require documentary verification. No diagram is proof of those controls.

```mermaid
flowchart LR
  Staff[Authorized facility staff] -->|HTTPS| Browser[Browser workstations]
  Browser -->|Session authenticated requests| App[Vercel: Next.js application and APIs]
  App --> Auth[Role, facility, session and request checks]
  Auth --> Services[Clinical, finance, privacy and reporting services]
  Services -->|Prisma database access| DB[(Neon PostgreSQL)]
  Services --> Audit[Application audit records]
  Audit --> DB
  Services -->|Diagnostic term or code; server OAuth| WHO[WHO ICD API]
  DB -. Controlled backup tooling .-> Backup[Independent backup target: evidence pending]
  Audit -. Authorized export and verification .-> Retention[External immutable retention: evidence pending]
  App -. Disabled national transport .-> DHA[DHA / national systems]
  App -. AI library present; excluded pending boundary verification .-> AI[AI processing provider]
```

## Components and trust boundaries

- Staff devices/browser: clinical information is displayed to authenticated users; shared-device handling and local downloads require facility policy.
- Application boundary: Next.js 16.3.3 / React 19.2.8 on Vercel. Server endpoints enforce access; hiding UI controls is insufficient. Production credentials stay server-side.
- Persistence boundary: Prisma 6.12.0 with PostgreSQL on Neon stores clinical and operational records. Schema and migration inventory are version-bound in the manifest. Provider account access is a separate control from application roles.
- External service boundary: WHO receives the entered search query; no patient-record exchange is implied. AI libraries are present, but no operational AI claim is made. National transmission remains outside the proposal.
- Operations boundary: releases, database migrations, backups, audit exports and privileged provider administration require separate evidence and accountable custody. A retained Neon branch shares the provider boundary.

```mermaid
sequenceDiagram
  actor Clinician
  participant UI as Consultation workspace
  participant API as Application server
  participant WHO as WHO terminology API
  participant DB as PostgreSQL
  Clinician->>UI: Confirm patient, enter diagnostic term
  UI->>API: Authenticated terminology search
  API->>API: Check permission and facility
  API->>WHO: OAuth and terminology query
  WHO-->>API: Release-specific coded results
  API-->>UI: Signed selections with provenance
  Clinician->>UI: Select diagnosis and review encounter
  UI->>API: Save/sign encounter
  API->>API: Validate selection and workflow permissions
  API->>DB: Persist encounter/provenance and applicable audit
  API-->>UI: Confirm saved state
```

## Data-flow inventory

| Flow | Data and purpose | Destination/custody | Evidence still needed |
|---|---|---|---|
| Browser → application | Credentials, session requests, selected patient and care/billing input | Vercel application | Device policy, transport/configuration evidence, security assessment |
| Application → database | Identity, clinical records, finance, permissions, audit and governance | Neon PostgreSQL | Region/residency, processor terms, encryption, key and administrative access evidence |
| Application → WHO | Entered diagnosis term/code and server OAuth credentials | WHO ICD API | Approved terminology use, query-handling notice and clinical walkthrough; users must not enter patient identifiers |
| Patient rights export | Authorized patient's exported information | Authorized staff then approved recipient channel | Identity verification, custody, secure delivery and retention procedure |
| Backup | Database contents, potentially all patient data | Independent encrypted target to be evidenced | Target, keys, schedule, off-provider custody, measured restore |
| Audit export | Auditable activity records and integrity information | Approved immutable external target to be evidenced | Access policy, retention period, verification receipts |
| Support/telemetry | Necessary operational metadata | Application/provider tooling | Logging inventory, redaction review and access/retention evidence; do not assume no PHI leakage without review |
| AI, if later included | Selected clinical context can still be health data even without direct identifiers | Provider/project to be approved | Separate DPIA/terms/residency/retention, boundary review and clinical evaluation |
| National exchange, if later included | Approved profile-specific patient/report payloads | Authorized national endpoints | Contracts, credentials, profiles, consent/provenance, retry/idempotency and acknowledgement tests |

## Deployment and recovery

Application build and database migration are separate controlled steps. The released migration inventory has 43 entries; the local paused MFA migration is not part of it. Verify the exact health commit/migration pair before associating results with a deployment. A health response demonstrates a bounded connection/version check, not readiness approval.

The retained `pre-unified-release-20260922` Neon branch is a recovery point only. Restore drills must target a disposable database, measure approved recovery objectives, verify record integrity and preserve evidence. No restore against production is authorized by this document.
