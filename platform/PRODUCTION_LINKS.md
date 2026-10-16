# Mwein production links

The single staff entry point is **https://mwein-hmis-platform.vercel.app/**. Bookmark and share that address. It remains stable as a reviewed release is promoted.

The supported Vercel project is `mwein-hmis-platform` (`prj_dhuD47K8aNRoAteqQnSK3mu9j4DS`) in `mbitis-projects` (`team_cLGnYT9Z7jo4xZtFNkQTF7Ms`), with Root Directory `platform`. Application source is maintained on `codex/mwein-platform`. The root legacy pilot is not a second production HMIS.

## Link inventory and release controls

- The canonical host is the public HMIS entry. HMIS sign-in, facility permissions, MFA and clinical readiness gates remain applicable.
- Generated branch aliases and the team-qualified alias are not staff links. A link audit on 16 October 2026 found 13 alternate aliases returning Vercel sign-in; 12 pointed to older deployments. The canonical host alone returned the current public application.
- Unique deployment URLs and deployment IDs in release records identify historical builds. Preserve them for provenance and reviewed recovery; do not rewrite historical evidence to imply those builds were the current release.
- Preview deployment protection must remain enabled. Do not make old builds public to solve a broken bookmark. Any alternate-host redirect must be verified publicly without changing protection on the underlying deployment.

One release coordinator owns alias and production changes. Before changing an alias, retain its exact project, host, old deployment ID and redirect, and recheck the canonical live identity. Verify the result from an unauthenticated client, including the destination, path and query preservation, absence of loops, and unchanged canonical release. Retain a concrete undo operation. An API success alone is not proof that users can follow a link.

The initial direct-alias redirect canary was accepted by Vercel but still led to Vercel SSO because protection ran first. It was restored to its old mapping. This document does not claim that all alternate links have been redirected; completed live changes belong in the workflow log and routing evidence.

## Prevent recurrence

At the initial audit, Vercel reported production branch `main`, Git deployment creation enabled and automatic domain assignment enabled. These settings differ from the controlled `codex/mwein-platform` release process and must be reconciled by the release coordinator using supported controls. Do not enable automatic deployment of an unverified branch.

The current `platform/vercel.json` disables automatic deployment of `codex/mwein-platform`. Vercel documents unspecified branches as enabled by default; that single-branch guard does not disable deployments from old branches. A later configuration change must retain the all-agent test/retest gate and must not be silently folded into an already frozen application release. The `github.autoAlias` option is not a general switch that prevents generated branch aliases.

Every promotion must include a fresh alias inventory and checks that the canonical host serves the approved source and that established redirects remain effective. Report any remaining protected historical links separately from public redirects. Do not use a preview or hash-qualified deployment URL as the default link in staff instructions.

Official references: [generated deployment URLs](https://vercel.com/docs/deployments/generated-urls), [alias assignment and redirect API](https://vercel.com/docs/rest-api/aliases/assign-an-alias), [Git deployment controls](https://vercel.com/docs/project-configuration/git-configuration). These describe platform behavior; actual project changes require retained before/after verification.
