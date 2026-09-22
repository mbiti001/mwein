# Clinician shortage cover

The assignable `CLINICIAN_COVER` role (“Clinician — shortage cover”) includes normal clinician access plus patient registration, visit creation, measured triage observations, invoice viewing and payment collection. It is a complete role because Staff access replaces the selected user's role assignment.

A staff administrator assigns it in Administration → Staff access when an authorised clinician needs to cover an unexpected staffing shortage. The clinician signs in again after the access change. Restore the standard Clinician role when cover ends; both assignment and removal use the existing audited staff-access workflow and revoke existing sessions. Cover does not expire automatically and no clinician is assigned automatically.

From Consultation, the cover clinician can:

1. Start a visit for an existing patient, or register a new patient.
2. Capture measured vitals. For a routine outpatient check-in, completing triage opens that patient's consultation automatically. Walk-in and specialty clinics retain their existing service workflows.
3. Document and sign the consultation using the existing clinical safeguards.
4. Open billing, review the generated charges and collect payment. Cash receipts require that clinician's own open cashier shift.
5. Record an explicit clinical discharge outcome in the consultation room. Clinical closure remains separate from payment; financial completion still checks clinical closure, pending orders and the invoice balance.

The role does not grant payment reversal, cashier-shift approval, payer-claim submission, pharmacy dispensing, stock management or administration. Existing finance staff retain independent shift approval. Billing action controls now reflect these permissions as well as the server checks. The standard Clinician role is unchanged.

## Provisioning

`node scripts/release-clinician-cover-role.mjs` synchronizes only this role and its 13 existing permissions in one database transaction. It refuses incomplete provisioning when a base permission is missing. It changes no passwords and assigns no users. Run it using the controlled isolated release-job process; do not run the full bootstrap against production. No schema migration is required.

## Verification

The Playwright shortage-cover scenario uses only synthetic local data. It checks consultation-room entry, registration/check-in, blank initial vital observations, automatic routing to the same patient's consultation, real consultation API signing under the cover clinician's session, browser cash collection with a receipt, explicit browser discharge and retained confirmed payment. It also checks server rejection of reversal and cashier approval, and denial of the extra powers to a standard clinician. The wider role navigation suite covers the new role.

Validation on 22 September 2026: 239 unit tests, all 28 browser scenarios, TypeScript checking and the production build passed. The browser harness also completed its isolated database/API prerequisites. The cover role was tested with synthetic users; no live patient encounter was created for verification.
