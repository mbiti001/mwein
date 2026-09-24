# Production deployment — 25 September 2026 (Africa/Nairobi)

Published application: https://mwein-hmis-platform.vercel.app

- Deployed source: `1d1e5eac30296dfbeb1684361379eeff2a252c1c`.
- Vercel deployment: `dpl_nmBvuxSsjJbvGxgjDR7MG5eaEbcE`.
- Deployment URL: https://mwein-hmis-platform-5gf5roe1l-mbitis-projects.vercel.app
- Consolidation PR: https://github.com/mbiti001/mwein/pull/7, merged as `e04f55664d62556feb02037a6fd9e1a403a009bc`.
- Clean committed-source archive deployed; mandatory MFA explicitly enabled. No migrations, role provisioning or patient fixtures applied to production.
- Prior deployment retained as rollback target: `dpl_GYP1D49CYhCDvoQ1eCZA5SgsKJtR` (source `1beb4b4a338686db7068ddb9b97432730b6ddf60`). No new backup or restore exercise is claimed for this code-only release.

## Validation

GitHub Actions run [36062781915](https://github.com/mbiti001/mwein/actions/runs/36062781915) passed both legacy and platform jobs, including types, unit tests, migration/constraint checks, build, outpatient workflows, browser workflows and certification evidence retention. Local checks passed 361 unit tests, 47 migrations, 100 isolated outpatient checks and source-bound audit inventory (68 routes; zero gaps, unclassified routes or aliases).

After promotion, the release verifier confirmed the exact source SHA and migration `20260924130000_workforce_mfa`. Public HTTPS observations at 2026-09-24 21:42 UTC (25 September Nairobi):

| Endpoint | Result |
|---|---|
| `/api/health` | 200, database connected, expected release/migration, no-store |
| `/api/ready` | 503, blocked, no-store |
| `/api/patients` without credentials | 401, authentication required, private/no-store |
| `/` | 200 HTML, private/no-store |

This document and the certificate evidence update are subsequent documentation changes, not a different deployed application source. DHA readiness remains unapproved; see [current remaining work](DHA-READINESS-20260925.md).
