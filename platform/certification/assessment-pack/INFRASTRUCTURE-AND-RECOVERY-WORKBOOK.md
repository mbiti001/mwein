# Infrastructure, SSD recovery and incident evidence workbook

Version 2, 25 September 2026. Accountable owner: Edwin Mbiti Chavulimu. Owner identifies Charles as the backup SSD custodian and says it is kept away from the computer. Exact private location, separate-site status, drive identity/capacity, encryption, key recovery and current backup contents are unverified. This is an execution-ready review workbook; no production backup, restore, device formatting or incident rehearsal was performed by preparing it.

## Evidence collection and acceptance

Use internal OP identifiers below; these are not official DHA clause IDs. Each artifact must include collection date, source/release, operator, reviewer, protected location, SHA-256, limitations and decision. Redact secrets and patient content before adding metadata to Git. Keep originals, contracts, access exports and drill outputs in the approved private store; its location is not yet supplied.

| ID / control | Verified or owner-reported baseline | Required artifact and pass condition | Owner / status |
|---|---|---|---|
| OP01 Release | Public source 1d1e5ea; migration 20260924130000_workforce_mfa, 47 migrations; health 200 and ready 503 at last verification | [Deployment record](../DEPLOYMENT-20260925.md); match current health to approved source/migration before each drill | Release / engineering evidence available |
| OP02 Hosting and transfers | Vercel application, Neon database; prior function inspection iad1 | Project-specific regions, provider terms/subprocessors, access/MFA exports and DPO transfer assessment; identify all processing locations | Operations + DPO / incomplete |
| OP03 Encryption and TLS | Public HTTPS connection observed; no cloud encryption/key record in pack | Provider/database/backup encryption standard, configured TLS validation, key responsibility, authorized custodians and recovery test; never attach keys | Operations / incomplete |
| OP04 SSD backup custody | SSD chosen; Charles; away from computer (owner report) | Drive asset ID, encryption status without password, restricted location record, separate-site disposition, handover log and controlled key-recovery evidence | Charles / partial owner statement |
| OP05 Independent backup | Dump/checksum tooling exists; prior provider branch is within provider boundary | Successful protected backup, checksum, encrypted SSD transfer/read-back verification, independent second-location copy and custody receipt | Operations / not evidenced |
| OP06 Restore | Guarded disposable restore tooling implemented | Independently approved distinct target, measured restore, integrity/reconciliation checks and cleanup; meet approved RPO/RTO | Operator + separate reviewer / not run |
| OP07 Audit | 68-route source-bound inventory with zero gaps at release; export verifier exists | Authenticated export, independently verified digest/chain, enforced immutable target and receipt/access policy | Compliance / external evidence absent |
| OP08 Monitoring | Public health/readiness probes exist | External monitor configuration, recipients, test failure/alert, acknowledgement and response times; readiness blocked is an existing baseline | Operations / not evidenced |
| OP09 Workforce security | MFA implemented and required in release | Individual enrollment, joiner/mover/leaver and lost-factor recovery records; separate recovery administrators; access review | Identity owner / witnessed evidence pending |
| OP10 Incident/downtime | Procedures and operations evidence register exist | Named contacts, synthetic rehearsal, notification assessment and clinical/finance reconciliation; independent verification | Facility lead + DPO / not run |

## SSD operating procedure proposed for adoption

1. Charles records the device asset ID, capacity and private custody location. Confirm encryption with the device disconnected/reconnected and require authorized unlock. Keep evidence of the encryption configuration; do not record its password in this pack. Formatting or encryption conversion needs a device-specific plan that preserves existing contents.
2. Store keys/recovery material separately with approved restricted access and an authorized deputy. Demonstrate recovery of access without exposing the key. A password-protected folder is not evidence of full backup encryption.
3. Use an approved protected operator workstation and the existing `ops:backup` process. A PostgreSQL dump is not itself encrypted. Place `BACKUP_DIR` on an approved encrypted volume so plaintext staging does not land in Downloads or a synced folder. Record release/migration, backup timestamp, size and SHA-256; no connection strings in logs.
4. Copy the dump and checksum into the approved encrypted SSD location, read back and compare the digest, then record the custody receipt. Verification of a copied file does not prove that it can be restored.
5. Safely unmount and disconnect after use. Charles stores it away from the computer as instructed. Confirm whether that location also protects against the same fire/theft/flood event; 'away from computer' is not evidence of a separate site. Arrange a second protected copy/location and rotation to avoid a single lost/failed SSD eliminating recovery.
6. Follow the record-class retention/hold schedule based on applicable MOH guidance and Kenyan law. Backup rotation must preserve approved recovery points and must not become indefinite patient-data retention. Log sanitization/retirement and verify the supported SSD secure-erasure method before disposal.
7. Review daily backup completion/failure evidence and escalate missing runs. Existing operations guidance proposes at least daily backups; this cadence does not establish an approved recovery objective. Test restore quarterly and after material provider changes as specified in OPERATIONS.md; retain actual outcomes.

No drive or path has been selected for commands in this task. No production database was dumped and no data was moved onto a device.

## Recovery objectives and approval record

RPO is maximum acceptable data loss measured in time; RTO is maximum acceptable time to restore the service to the agreed usable state. Edwin and the clinical/operations reviewers must agree both, including whether the scenario is database loss, application outage or site loss. Record outage start, backup recovered-point timestamp, restoration start, integrity-check finish and clinical release time. Calculate observed data-loss interval from outage/reference time to recovered point, and recovery duration from the agreed incident start to verified service availability. Clock source/timezone: UTC plus local display.

| Field | Current value |
|---|---|
| Approved RPO / RTO and scenario | Pending; no target inferred from backup frequency |
| Operator / independent observer | Pending; Charles is identified as SSD custodian only |
| Backup ID, time, digest, encrypted custody | Pending actual backup |
| Disposable target identity / expiry / authorization | Pending; must be independently distinct from production |
| Exercise date / patient-data authorization | Pending; synthetic dataset preferred for rehearsal |
| Restore result / observed RPO / observed RTO | Not run |
| Clinical/finance acceptance / cleanup receipt | Not recorded |

## Witnessed restore run card

Use [the verified disposable restore plan](../../OPERATIONS.md#verified-disposable-restore-plan). It requires a private approval file with reviewer/reference/expiry, source and target identity hashes, distinct verified PostgreSQL system identifiers and approved backup hash. The runner rejects equivalent/pooler identities, unsupported overrides, expired/mismatched approvals, checksum mismatch and identical system identifiers. A cloned provider branch may share a system identifier and be rejected; arrange a genuinely separate disposable system instead of weakening the guard.

Before running, the operator and reviewer inspect target provider/project/database identity, network access, isolation, storage and lifecycle. Do not put production credentials in a preview app. Record the backup chain/custody, verify checksum after retrieving from the SSD, and confirm `psql`/`pg_restore` prerequisites. Populate secrets only in the protected operator environment; execute the existing `npm run ops:restore-drill` with the reviewed plan. This document does not manufacture an approval file or authorize destructive restoration to an unknown target.

Acceptance checks: migration head; facility boundaries; expected table/record counts; signed record integrity; representative orders/results/dispensing/payment links; audit chain; expected user restrictions; synthetic application read/write. Reapply restriction/deletion/hold decisions as required before any operational use. Record every discrepancy, disposition and observer signature. A command exit code alone is not acceptance. Destroy the disposable target and revoke temporary access after preserving protected evidence. If a check fails, preserve diagnostics safely and keep the exercise failed until a separately recorded successful rerun.

## Downtime and incident rehearsal

Use synthetic events: application outage during an unsigned clinical save; lost SSD; suspected staff-account compromise; failed backup/audit export. Record detection time, person reporting, incident lead and DPO notification time. Preserve evidence and contain affected access through an authorized operator. Do not send patient data or secrets through ordinary support channels.

For downtime, the clinical lead declares the approved temporary workflow. Assign unique temporary patient/visit references; record medicine/results/payment actions and responsible staff. On recovery, reconcile each entry once against existing domain/audit records; confirm identity, outstanding orders, medicine quantities and payments. Finance checks duplicate collections; clinical lead resolves outstanding care/follow-up. Record discrepancies and restoration acceptance before closing the incident.

The DPO determines controller/processor role, affected people/data, harm, applicable Kenyan reporting duties and timing, and records the decision and communication evidence. Contacts, legal notification assessment and duty-specific deadlines belong in the controlled incident plan. An SSD-loss exercise must assess encryption and key compromise, not assume encryption eliminates every reporting duty. This task sends no incident notification.

## Blank evidence receipt

Artifact ID / title / version: pending. Source and release: pending. Operator / collected-at UTC: pending. Protected URI / SHA-256: pending. Redaction/limitations: pending. Reviewer / review date / decision: pending. Follow-up owner/date: pending. For SSD handover add drive asset ID, encrypted container/backup ID, from/to custodians, timestamp and receipt; omit keys and patient identifiers.

## Completion order

First obtain SSD encryption and key-custody evidence, exact private location and separate-site decision; agree RPO/RTO and the operator/observer. In parallel collect provider, TLS/encryption and executed contract records. Then make and verify the approved encrypted backup and run the witnessed isolated restore. Complete monitoring and incident/downtime rehearsals. Retain evidence and approvals against the actual governance gates; do not mark them approved because this workbook exists.
