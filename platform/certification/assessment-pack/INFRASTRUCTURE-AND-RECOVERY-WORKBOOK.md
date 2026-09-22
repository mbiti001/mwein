# Infrastructure, recovery and incident evidence workbook

Accountable operations owner: Edwin Mbiti Chavulimu. Technical operator/independent reviewer to be named for each exercise. No production backup, restore, configuration change or incident rehearsal was performed by preparing this workbook.

## Project-specific collection sheet

| Control | Known baseline | Required evidence / collection |
|---|---|---|
| Application deployment | Vercel project mwein-hmis-platform; deployment in release manifest | Authorized project export showing runtime region, deployment access and approved domains |
| Database | Neon PostgreSQL; 43 deployed migrations | Authorized project/branch region, TLS enforcement, encryption and role/access evidence |
| Recovery point | pre-unified-release-20260922 provider branch recorded | Current retention/expiry check; independent backup and restore evidence still required |
| Key/secret custody | Server-side secrets used; no values included here | Named custodians, rotation/access procedure, least privilege and access review evidence |
| Audit retention | Export and verification tools exist | Immutable target policy, custody receipt, integrity output, approved retention |
| Monitoring | Health/readiness endpoints exist | Configured checks, alert routing, test alert and acknowledgement; status probe alone is not monitoring |
| Residency/processing | Providers known, actual regions not evidenced in pack | Region configuration + contractual processing/subprocessor/transfer evidence |

## Recovery drill run card

Before execution, name controller, operator, observer and incident lead; approve recovery point objective (RPO) and recovery time objective (RTO). Record dataset scope, backup timestamp/size/hash, encrypted off-provider location, restricted key custody and a disposable restore target demonstrably distinct from production. Secret URLs must not enter this workbook or terminal artifacts.

Use the reviewed backup tooling with authorized access; transfer the resulting backup into the approved protected store. Restore into the approved disposable database using OPERATIONS.md. Verify migration head, facility boundaries, record counts, signed clinical content, sample order/result/prescription/payment relationships and audit integrity. Record restore start/end, recovered point, comparison results, limitations and measured RPO/RTO. Run a synthetic read/write smoke check. Record cleanup and access revocation after preserving evidence.

The existing restore script compares connection strings for equality; differently formatted URLs can still refer to the same database. The operator must independently verify target host/project/branch/database identity before any destructive restore. No restore should start until this concrete target evidence exists.

Results: not run. Backup location: pending. Target: pending. RPO/RTO: not approved. Independent observer: pending.

## Downtime and incident rehearsal script

Simulate application unavailability using a synthetic scenario. Facility lead declares downtime and notifies named responders. Staff use approved controlled paper/temporary records and preserve identity/visit linkage. On recovery, authorized staff reconcile each record once, verify results/medicines/payments and record unresolved discrepancies. Finance checks for duplicate collections. Clinical lead confirms outstanding care and follow-up. Retain declaration/recovery times and reconciliation evidence.

For a suspected confidentiality/integrity incident, preserve evidence, restrict affected access through authorized operators, identify records/people affected and escalate to the DPO and incident lead. The DPO determines applicable notification obligations/timelines from current law and approved policy. Do not send patient data in ordinary support channels. Contacts, notification decision and rehearsal outcomes remain pending.


## Read-only evidence collected

On 22 September 2026, Vercel CLI deployment inspection reported Ready and `iad1` on listed functions. The public health response matched the exact documented commit/migration at 16:26 UTC; readiness remained blocked. Outputs are retained under [technical evidence](technical-evidence-20260922/manifest.json). These observations do not establish database region, all processing locations, encryption/key controls or independent recovery. The Vercel connector had incompatible argument schemas; the existing authenticated CLI provided the deployment metadata instead.
