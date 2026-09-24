# Reception vitals and workflow review

Reviewed 22 September 2026. Accountable owner: Edwin Mbiti Chavulimu.

## Finding and correction

Reception could register and check in a patient but could not capture measurements. Check-in also routed Reception into the clinical triage screen despite lacking clinical triage permission.

A dedicated `vitals.write` permission now supports recording actual measurements against an open visit. Check-in routes Reception to Vitals. Unmeasured fields stay blank. Recording measurements does not complete triage, assign clinical priority or move the clinical queue. Nurses can explicitly import the latest recorded set into triage, assess the patient and complete the remaining clinical fields. The triage record retains its source measurement ID; consultation displays the recorded measurements. Recorder, measurement time and immutable history remain available. Corrections require a new set and explanatory note rather than overwriting history.

| Role | Measurement access | Existing responsibility retained |
|---|---|---|
| Reception | Capture and view visit measurements | Registration and check-in |
| Nurse | Capture and review measurements | Clinical triage |
| Clinician | Capture and view measurements | Consultation, orders and clinical closure |
| Clinician shortage cover | Capture and review measurements | Existing authorized cross-department coverage |
| Medical director | Capture and review measurements | Clinical oversight |

Reception gains no clinical triage, prescribing or financial permissions. Clinical and billing closure remain separate. Staff must be trained in the measurements they perform; workflow access is not proof of professional qualification.

## Comparison boundary

Hosipoa publicly describes a shared patient journey across reception, triage, consultation, laboratory, pharmacy, billing and discharge: [product overview](https://www.hosipoa.co.ke/) and [modules](https://www.hosipoa.co.ke/modules/). This correction follows that connected-record approach. Public descriptions do not disclose Hosipoa's internal permission matrix, so exact role parity is not claimed. No private Hosipoa account was inspected.

## Release status

The read-only production health response at 2026-09-22T17:46:01Z identified commit `a5e19d3ee6edc08a21f7c8e836962c8be66dfcb7` and migration `20260923140000_clinical_closure_identity_history`. Production was reachable and its database connected. This does not establish DHA certification readiness.

Remediation, local aggregate reporting, local IDSR and this vitals change are pending rollout. The vitals release adds migration `20260924120000_measured_vitals` and a reviewed, scoped permission provisioning script. Apply all pending migrations and prior reporting/IDSR permission provisioning in the release sequence. Do not run bootstrap against production. Verify Reception check-in → measurement capture → nurse review → consultation in staging before rollout. Refresh staff sessions after provisioning.

## Work remaining

1. Stage and release the committed control, reporting, IDSR and vitals changes; verify deployed roles, migrations and the complete patient journey.
2. Complete local reporting/IDSR acceptance with Busia County / Nambale Subcounty, MFL 31749 (user supplied): designated surveillance responsibility, approved case definitions, forms, reporting calendar, routing, escalation and weekly returns. The local register is not national reporting integration.
3. Implement accepted KHIS/national exchange mappings, authorized transport, retries and receiving-system acknowledgements once the required profiles and access are confirmed. Staff-recorded notification is not external acknowledgement.
4. Complete clinical UAT, accessibility/performance assessment, independent security testing, monitored backup custody and a measured recovery drill; resolve findings and retain release-bound evidence.
5. Obtain applicable DHA submission/checklist confirmation and approved governance, DPIA, hosting/encryption and operational evidence. Individual/innovator registration alone does not prove fee waiver or technical exemption.

Native MFA remains paused at the user's instruction. The original draft checkout is excluded from this release. See the [implementation backlog](APP-AUDIT-AND-IMPLEMENTATION-BACKLOG.md) and [reporting/IDSR requirements](REPORTING-IDSR-REQUIREMENTS.md) for the wider assessment.

## Verification

The isolated release candidate passed TypeScript checking, 317 unit tests across 73 files, all 46 migrations (including direct database rejection of measurement update/deletion), a production build and all 40 browser scenarios. The Reception scenario verifies check-in routing, blank defaults, stored measurements, unchanged clinical queue/priority, denied clinical triage access and a nurse's explicit import with source linkage. Existing shortage-cover billing/discharge scenarios also passed. These are synthetic engineering checks, not clinical acceptance or production deployment evidence. All 25 paused draft files in the original checkout retained their recorded hashes.

A separate browser inspection of the synthetic Reception session confirmed the Vitals navigation, patient/visit context and blank measurement form render correctly without reported browser errors.
