# DHA controls production release — 22 September 2026

Deployed application commit: `e1fa5edb81e30af836f9baebf8366da2d8297ee3`.
Production: https://mwein-hmis-platform.vercel.app
Deployment: `dpl_9UWHKD1RngYfdpwyoBCmw7AM8DHL`.

Retained Neon recovery branch: `pre-dha-controls-e1fa5ed`, ID `br-divine-tooth-au1vywti`, parent `main` (`br-calm-night-auqcrsjo`), created 2026-09-22 21:37 Nairobi, expiry Never. Provider history: six hours. This is a provider recovery point, not an independent encrypted backup or witnessed restore drill.

Controlled migration deployment `dpl_3zZrki8oTfUhftXMDEJdST8tXxy6` successfully applied four migrations through `20260924130000_workforce_mfa` (47 total), then synchronized reporting, surveillance and measured-vitals permissions. No user assignments or credentials were changed. The migration job did not replace the public application domain.

Application build passed, including a production AUTH_SECRET presence/length check without printing or replacing the secret. MFA_REQUIRED=true was supplied to build and runtime. Production health verification matched the exact application commit and latest migration. Browser verification of the public root displayed the mandatory MFA enrollment gate for the existing staff session. No authenticator was enrolled on behalf of staff.

/api/ready still returns HTTP 503, status blocked: deployment is complete but DHA readiness remains pending the outstanding governance and external evidence listed in assessment-pack/REMAINING-WORK-STATUS.md.
