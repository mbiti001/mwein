# WHO ICD-11 connection

The app uses WHO ICD API v2, ICD-11 MMS release `2026-01`, in English. WHO lists that release as supported at https://icd.who.int/docs/icd-api/SupportedClassifications/.

Obtain client credentials through https://icd.who.int/icdapi. Store `ICD11_CLIENT_ID` and `ICD11_CLIENT_SECRET` only as server-side Production secrets in the existing Mwein HMIS Vercel project; set `ICD11_RELEASE=2026-01`. Never use a `NEXT_PUBLIC_` prefix, source control, query strings or chat messages for credentials. Environment changes require a new deployment.

Run `npm run ops:icd11-verify` in the environment containing those credentials. It requests an OAuth token and searches the fixed generic term “cholera”, checking coded results and release-specific WHO URIs. It prints only verification metadata, never tokens or secret values. This check does not access the patient database or transmit patient records.

The clinician's diagnosis search sends the entered terminology query to WHO; enter diagnosis terms or codes, not patient identifiers or copied clinical notes. Results are signed for the current facility, retain the selected MMS release and WHO URIs, and cannot be silently changed between search and save. Previously recorded facility diagnoses remain available when WHO is unavailable; the UI labels that fallback. No national patient-record exchange is enabled by this terminology connection.

Before activation, retain successful connection-check output and verify generic diagnosis search in a clinician session. Record clinical terminology governance separately; successful API authentication alone is not a clinical coding sign-off or DHA certification.

Implementation checks: token reuse, one refresh after HTTP 401, facility-scoped outage fallback, permission enforcement, private/no-store responses, and diagnosis selection signatures.

## Activation evidence — 22 September 2026

The user completed WHO registration and licence acceptance and authorized saving the existing client credentials in Mwein's Vercel Production secrets. `ICD11_CLIENT_ID`, `ICD11_CLIENT_SECRET` and `ICD11_RELEASE=2026-01` are configured for Production only.

Controlled verification deployment: `dpl_GjmVg99bdABRSUazVa1dxPKsEdNF`. At `2026-09-22T14:15:51.056Z`, the live OAuth/search check returned `verified`, WHO API `v2`, MMS release `2026-01`, language `en`, and 16 coded results. No patient data was sent. This static verification deployment is not the application release.

Ten focused tests passed across the WHO search route, identifier normalization and signed diagnosis selection. Type checking and the application build passed. Token reuse, short token lifetimes, one refresh after rejection, permission denial and facility-scoped fallback are covered.

Published application: `dpl_BidccfBYsueHqA7YubtDH4BiC6xD`, source commit `bc35584f7e7426cf4585c49d488f63da6c33e379`, at https://mwein-hmis-platform.vercel.app/. The staged health probe confirmed this commit and the unchanged migration head before promotion. No database migration or patient-record mutation was required.

Browser verification limitation: the clinician session had no patients awaiting consultation, and the browser connector blocked direct navigation to the authenticated JSON search endpoint (`ERR_BLOCKED_BY_CLIENT`). No patient was created or altered just for testing. Live WHO authentication and release-specific results were verified in the controlled Production job; the app route's mapping, signing and fallback behavior were verified by focused tests. The next normal clinician consultation can exercise the complete selection UI.
