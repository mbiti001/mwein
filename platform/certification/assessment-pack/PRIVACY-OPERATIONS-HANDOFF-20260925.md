# Privacy and operations review handoff — 25 September 2026

Prepared against deployed source `1d1e5eac30296dfbeb1684361379eeff2a252c1c`. Documentation preparation is complete for this iteration; privacy approval and operational execution remain pending. No clinical data copied, backup created, SSD altered, restore run, approval gate changed or regulatory submission made.

## Owner decisions recorded

- Both ODPC controller and processor certificates supplied and visually reviewed; metadata/checksums recorded separately.
- Backup medium: SSD. Custodian: Charles. Kept away from computer. This does not establish encryption, a successful current backup or a separate physical site.
- Retention policy authority: applicable Ministry of Health guidance. Other processing and operating requirements: applicable Kenyan laws. This policy direction does not supply the record-class periods or certify compliance.

## Ready for review

1. [Mwein-specific DPIA](PRIVACY-DPIA-AND-PROCEDURES-DRAFT.md): processing inventory, role distinctions, proportionality, children/rights, 11 preliminary risks, treatment evidence and consultation/sign-off records.
2. [Privacy decision schedules](PRIVACY-DECISION-SCHEDULES.md): retention authority check, record classes, processors/transfers, patient notice draft and accountable decisions.
3. [SSD and operational evidence workbook](INFRASTRUCTURE-AND-RECOVERY-WORKBOOK.md): ten evidence controls, backup/custody procedure, guarded restore run card, recovery measurement and incident/downtime exercise.
4. Updated architecture, index, evidence register and document checklist reflect the live MFA/reporting/migration baseline.

## Next evidence to complete

| Priority | Concrete deliverable | Responsible review |
|---|---|---|
| 1 | SSD encryption/asset record, protected custody location, key-recovery/deputy arrangement and separate-site decision | Charles + operations; Edwin accountable |
| 1 | Applicable MOH retention schedule/version and class mapping; patient/DPO contact channel, approved processing bases and provider agreements | Charles/DPO + health records lead |
| 1 | Project-specific database/hosting region, TLS, encryption/key responsibility and access evidence | Operations + DPO |
| 2 | Agreed RPO/RTO, named operator/observer, approved separate restore target and encrypted backup custody | Edwin + clinical/operations reviewers |
| 2 | Actual restore timings, integrity checks, cleanup and independent acceptance; monitoring/incident/downtime records | Operations, clinical and finance reviewers |
| 3 | DPIA consultations, residual-risk decisions and signed version; final private evidence-store references | Charles/DPO and Edwin |

No universal seven-year retention rule was adopted: the ODPC health-data guidance uses seven years as an example, while an applicable current MOH record-class schedule was not retrieved. The pack explicitly records that source gap and does not configure automatic deletion.

## Submission status

Drafting does not close the `DPIA_DPA`, `BACKUP_RESTORE_DRILL`, `INCIDENT_RESPONSE` or `AUDIT_RETENTION` gates. Only actual retained evidence and accountable decisions can support those approvals. The current [DHA readiness review](../DHA-READINESS-20260925.md) covers clinical, reporting, integration and independent-assessment work beyond this pack.

## Follow-up operations evidence

[25 September hosting/TLS evidence and backup preparation](technical-evidence-20260925-operations/README.md) records the newer public release `83fdd61` (documentation-only difference), provider inspection, verified public TLS, unavailable external SSD/toolchain and tested backup credential protection. Physical backup/restore and DPO approval remain pending.
