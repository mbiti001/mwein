# Isolated workflow databases

`e2e-outpatient.mjs` keeps its existing synthetic assertions and bootstrap data.
With `E2E_TEST_DATABASE_URL` absent it uses the local PGlite adapter. An explicitly
set variable selects native PostgreSQL; an empty or invalid value fails instead
of falling back. The fixture never selects a database from `DATABASE_URL`.

Native URLs must include credentials, an explicit loopback port and a dedicated
`mwein_e2e_*` database name, with no query or fragment. Before migration or
bootstrap, the fixture verifies the connected database identity and checks for
existing user schemas, relations, functions and types. A populated database is
rejected. The fixture does not create, reset, drop or reuse databases.

Provide a freshly created disposable database for each invocation. CI uses two
separate PostgreSQL 18.3 services: one for the standalone workflow fixture and
one for the browser fixture. Their credentials and data are synthetic. Local
native runs require the same fresh-database setup; never point this fixture at
a facility database. Cleanup closes only the fixture connection. The caller
owns disposal of the isolated database/service.

The helper pins fixture connections to the public search path, applies bounded
connection/query timeouts, and sanitizes connection failures. It does not add
application retries or suppress transaction errors. PGlite adapter failures and
native PostgreSQL failures must remain distinct in release evidence.
