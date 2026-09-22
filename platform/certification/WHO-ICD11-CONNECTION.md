# WHO ICD-11 connection

The app uses WHO ICD API v2, ICD-11 MMS release `2026-01`, in English. WHO lists that release as supported at https://icd.who.int/docs/icd-api/SupportedClassifications/.

Obtain client credentials through https://icd.who.int/icdapi. Store `ICD11_CLIENT_ID` and `ICD11_CLIENT_SECRET` only as server-side Production secrets in the existing Mwein HMIS Vercel project; set `ICD11_RELEASE=2026-01`. Never use a `NEXT_PUBLIC_` prefix, source control, query strings or chat messages for credentials. Environment changes require a new deployment.

Run `npm run ops:icd11-verify` in the environment containing those credentials. It requests an OAuth token and searches the fixed generic term “cholera”, checking coded results and release-specific WHO URIs. It prints only verification metadata, never tokens or secret values. This check does not access the patient database or transmit patient records.

The clinician's diagnosis search sends the entered terminology query to WHO; enter diagnosis terms or codes, not patient identifiers or copied clinical notes. Results are signed for the current facility, retain the selected MMS release and WHO URIs, and cannot be silently changed between search and save. Previously recorded facility diagnoses remain available when WHO is unavailable; the UI labels that fallback. No national patient-record exchange is enabled by this terminology connection.

Before activation, retain successful connection-check output and verify generic diagnosis search in a clinician session. Record clinical terminology governance separately; successful API authentication alone is not a clinical coding sign-off or DHA certification.

Implementation checks: token reuse, one refresh after HTTP 401, facility-scoped outage fallback, permission enforcement, private/no-store responses, and diagnosis selection signatures.
