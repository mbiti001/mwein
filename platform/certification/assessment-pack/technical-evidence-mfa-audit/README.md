# Synthetic engineering evidence

22 September 2026. This directory records local engineering tests; it does not certify production or clinical acceptance.

- TypeScript checking and production build passed.
- Unit tests: 356 passing across 78 files.
- Migrations: all 47 applied successfully to the isolated database, with database invariants checked.
- Browser regression suite: 42 passed; one new recovery test queried the session before login completed. Its helper was corrected to await the login response and next screen. The subsequent focused run passed all three MFA scenarios, including that recovery case. Thus all 43 distinct browser scenarios have passing results across the full and focused runs; no claim of an uninterrupted 43/43 run is made.
- Production-mode synthetic fixture passed 99 API/database checks, including mandatory MFA, encryption, token rotation, session revocation and unchanged role boundaries. The ordinary browser fixture allows optional first enrollment; a separate production-mode server explicitly requires MFA for its enforcement tests.
- Browser visual inspection confirmed the setup screen with Google Authenticator wording, readable layout and no reported browser errors. Only synthetic accounts were used.
- Audit inventory: 68 route files, zero missing static audit controls, zero unclassified routes and zero unreviewed aliases. This is not exhaustive branch-level coverage or independent security assessment.
- Dependency installation reported zero known vulnerabilities at installation time; this is not a penetration test.
- All 25 source-draft hashes in the original checkout remain unchanged. The reviewed implementation exists in the remediation checkout.

The retained pre-fix browser output intentionally preserves the failed test result. The focused output records its successful rerun. Source code fixes were included in the production build used for these tests; only the test wait helper changed between the final full suite and focused run. Formatting-only removal of trailing whitespace does not alter runtime behavior.
