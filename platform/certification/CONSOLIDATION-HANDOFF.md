# Browser-side consolidation handoff

Working branch: `codex/dha-readiness-remediation`. No production deployment or production database migration was performed.

## Priorities 1–4

1. **Clinical lifecycle:** `Visit.clinicallyClosedAt` and the final `VisitDisposition` are independent of invoice settlement. Clinicians close signed visits through `POST /api/visits/:id/discharge`. Outcomes include recovered, outpatient care, deceased, referred, against medical advice and other. Outpatient care is never inferred to mean recovered. Exceptional consultation signing invokes the same closure service. Referral closure requires a sent referral. Final outcomes cannot be silently overwritten. Existing signed visits can use the new discharge control without changing signed notes.
2. **Overdue handling:** manual `OVERDUE_UNPROCESSED` cancellation validates the current waiting queue against the configured service-point target and existing priority policy. It does not run on a timer. Signed care, completed/in-progress services, payments and submitted claims remain protected. Queue escalation records a reason and service point in audit history; staff must contact the lead themselves. No automatic notification or automatic change in clinical urgency is claimed.
3. **Identity:** reviewed demographic correction and emergency reconciliation retain before/after snapshots and identifier provenance, preserve privacy restrictions, block identifier conflicts and avoid destructive patient merging. The latest correction can be reversed if the current demographics still match its snapshot. A reversal releases only the identifier added by that correction; its provenance remains in the retained snapshot. Local documentary evidence produces `DOCUMENTED`, not national-registry verification. There is no automatic duplicate merge or national registry lookup.
4. **Consultation:** preserves the existing structured history/examination/diagnosis/order/treatment workflow and signed-record addenda. Signing now requires a saved management plan, records the signer, persists the actual signing disposition and uses explicit closure for exceptional outcomes. Visit summaries distinguish planned disposition from final outcome and show closure attribution. Stale order/consultation/queue mutations cannot restart clinically closed visits through the updated endpoints.

## UI and evidence preserved

- RGB teal/slate design layer, responsive cards, keyboard focus and reduced-motion support.
- Patient-task search, overdue filter, admin evidence snapshot and new clinical-discharge/identity panels.
- Earlier certification workflow scaffolding, CSP nonce work, release/audit scripts and evidence documentation remain in this branch. These are not all production-ready integrations.
- ODPC source: **MWEIN MEDICAL SERVICES Registration Certificate.pdf**, Library reference `libfile_a474ad065e288191b44391b8dcc739fa`. Recorded Data Controller identification: `112-9801-11EB`; serial `27289`; stated validity 2026-09-22 to 2028-09-22. The supplied document was inspected; independent registry authentication is not claimed. The certificate itself is not committed. Registration does not substitute for DPIA, processor contracts, retention controls or DHA certification.

## Migration and merge boundaries

Apply the complete migration chain in an isolated database first. New migrations in this uncommitted-work consolidation:

- `20260923100000_certification_workflows`
- `20260923120000_core_visit_disposition`
- `20260923140000_clinical_closure_identity_history`

Reconcile local `codex/unified-patient-workflow` changes especially around patient privacy/export APIs, consent, `schema.prisma`, `ClinicalApp`, consultation, billing completion, visit summaries and audit. Preserve the local privacy/export work. There is no automated historical outcome backfill: legacy signed visits require clinician review, and old completed records are not retrospectively labelled recovered.

## Safety and release limits

- In-progress services block closure until explicitly resolved; the app does not discard partially delivered care. Validate the operational resolution pathway with clinicians, especially partial dispensing and exceptional outcomes.
- Explicit cancellation of unstarted orders preserves invoice items/claims/payments. Billing staff must review any affected charges through their controlled workflow; clinical discharge never silently writes off debt.
- The earlier exchange outbox is scaffolding: channel-specific acknowledgement validation, send locking and full production approval remain outstanding. Keep transport disabled. Transport credentials are now excluded from browser responses.
- Identity correction currently requires the existing `patient.create` and `patient.read` permissions. Review whether the combined release should introduce a dedicated records-officer grant and independent approval for high-risk changes.
- Browser visual/interaction verification remains outstanding because the Chromium download previously returned an invalid archive. API-to-database tests do not replace browser or clinician UAT.
- Reconcile production migration history, backups, release SHA and rollback evidence before deployment. Do not treat the internal evidence dashboard as a DHA score or certificate.

## Verification commands

`npm run db:generate`, `npm run lint`, `npm test`, `npm run test:migrations`, `npm run build`, then `E2E_PRODUCTION=1 npm run test:e2e`.

The end-to-end harness uses synthetic records and an isolated PGlite database. It includes clinical/financial separation, role/facility denial, identity correction/reversal and duplicate blocking, all requested discharge outcomes, referral handover, overdue review/cancellation, exceptional signing, stale writes and audit-chain verification.

Final checks: 224 unit tests across 56 files passed; 40 migrations applied and verified; TypeScript/lint and production build passed; the production-mode isolated API/database harness passed 92 checks. The overdue regression caught a missing database check-constraint update; the new migration now explicitly admits `OVERDUE_UNPROCESSED` while retaining the other reason restrictions. Browser interaction/visual validation is not included in these results.
