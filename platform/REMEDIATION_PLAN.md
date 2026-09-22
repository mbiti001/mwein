# DHA readiness and simplification delivery plan

20 September 2026. This plan prioritises findings from the source audit of commit `3c0339d`. Completion of engineering tasks is not certification.

## First change: release controls and access traceability

Implemented on `fix/platform-release-and-privacy-audit`:

- A dedicated `Platform verification` CI job: locked installation, Prisma generation, typecheck, tests, migration checks, build, isolated outpatient workflow and Playwright tests.
- Build-time database migration removed; controlled `release:migrate` remains explicit.
- Supported hosting-root instructions added; legacy deployment files are clearly distinguished.
- Authorised read events added for patient search/history, active visits, summaries and verified diagnostic results, with no clinical text or search terms in the events.
- Data withheld when recording these access events fails; responses marked private/no-store.
- Public readiness exposes only status, with detailed evidence available through existing permission-controlled admin APIs.
- Integration runner gains progress logs and bounded setup, HTTP requests and cleanup.

Local verification: 199 unit/component/API tests passed, TypeScript passed, all 36 migrations passed and `vercel-build` passed without running migrations. All 71 production-mode outpatient integration checks passed, including retained read-event identity and chain verification. The fixture now binds to localhost and drains deferred socket-close callbacks before destroying PGlite. Local browser verification is pending: the Playwright Chromium download timed out; CI includes installation and browser execution. These checks must pass before merging. Branch protection has not been configured by adding a workflow; the repository administrator must require the new check.

## Next increments, in order

| Priority | Deliverable | Acceptance condition / dependency |
|---|---|---|
| 1 | Safe registration and identity review | Clinician/DPO-approved emergency, unidentified-patient and guardian paths; two children may share a guardian phone; uncertain identities require review without inventing consent or merging records. |
| 2 | Consent and patient-request lifecycle | Record notice/lawful basis, representative, withdrawal and corrections; stop withdrawn messaging consent; retain signed clinical history and legal holds. Requires approved facility policy. |
| 3 | Workforce identity | OIDC discovery/callback/logout with PKCE/state/nonce, provider MFA assurance, staff deprovisioning and governed emergency access. Requires approved provider details and test accounts. |
| 4 | One patient/visit workspace | Today and Patients lead into the same visit; specialty forms appear in context; preserve save/sign/result-verification safeguards. Staff can complete returning-patient check-in in a measured usability session without re-entering identity. |
| 5 | Operational evidence and release enforcement | Real encryption/key evidence, ODPC/DPIA records, retained backups and measured restore; separately verify actual hosting root, branch protection and safe traffic admission. Do not treat configuration strings as operating controls. |
| 6 | National exchange/reporting | Agreed DHA profile versions, sandbox access, validated identifiers/terminology, retries and acknowledgements; approved reporting/notification mappings. SHA contract activation stays a separate dependency. |
| 7 | Clinical assurance and submission | Named clinical owner validates medication rules, overrides, critical results and specialty pathways; independent security assessment; complete the actual DHA evidence checklist. |

MFA, DHA exchange and external evidence remain open. This change does not enable live claims, alter consent policy, or certify the product. Access-audit coverage is deliberately stated per endpoint; remaining clinical endpoints and print/export intent need follow-on review.
