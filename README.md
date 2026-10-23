# Mwein Medical Services

One repository, three independently deployed applications.

| Directory | Purpose | Deployment root |
| --- | --- | --- |
| [`website/`](website/README.md) | Public patient website: PHP and SQLite | `website/site/` contents → existing cPanel public root |
| [`platform/`](platform/OPERATIONS.md) | Supported HMIS: Next.js and PostgreSQL | Keep the Vercel Root Directory set to `platform` |
| [`legacy/`](legacy/README.md) | Retained Node/SQLite compatibility pilot | `legacy/`, for compatibility testing only |

## Public website

Run `npm run website:build` after editing HTML, PHP, CSS or JavaScript. It generates fingerprinted CSS bundles and updates asset references without dependencies. Run `npm run website:test` for JavaScript and source checks. With PHP 8.4 and Python available, run `python website/tests/backend_test.py` and `php website/tests/jpeg_metadata_test.php` as well. Preview with `npm run website:dev` (requires PHP on PATH); private configuration stays outside `website/site/`.

## HMIS

Run commands inside `platform/`: `npm ci`, `npm run db:generate`, `npm test`, then the documented build/release sequence. Clinical releases, database migrations and patient data are managed separately from website releases. See [`platform/OPERATIONS.md`](platform/OPERATIONS.md).

## Repository migration

`website-rewrite/` is now `website/`. Root pilot files, its deployment configuration, scripts and tests are now in `legacy/`. Its internal relative paths are preserved. Existing pilot automation must use `legacy/` as its working directory; Docker uses `docker build legacy`. Do not move production databases as part of this source reorganization. Existing HMIS deployment paths stay unchanged.

Root npm commands are explicit shortcuts, not an application server. `npm start` directs you to select an application. GitHub Actions verifies the website, supported platform and legacy pilot separately. Never upload the repository root to cPanel: publish only reviewed website files and preserve the existing private configuration, uploads and database.

Open `Mwein.code-workspace` for separate website, HMIS and legacy folders. See [`website/RELEASE-20261023.md`](website/RELEASE-20261023.md) for this website change and deployment limits.
