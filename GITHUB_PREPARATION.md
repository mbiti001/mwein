# GitHub Preparation

## Current Connection

The local repository is connected to:

```text
origin  https://github.com/mbiti001/mwein.git
branch  main
```

Remote connectivity was verified against `refs/heads/main`. The local and remote branches currently point to different commits, and the local index contains unrelated staged website changes. Do not force-push or publish the current index as-is.

## Prepared Automation

`.github/workflows/ci.yml` runs on pushes, pull requests, and manual dispatch. It checks JavaScript syntax, runs the API and recovery tests, builds the hardened container, creates the allowlisted cloud ZIP, and uploads that ZIP as a short-lived GitHub Actions artifact.

The workflow does not deploy patient-facing infrastructure automatically. Production deployment remains intentionally gated by `PRODUCTION_READINESS.md` and `CLOUD_DEPLOY_CHECKLIST.md`.

## Safe First Push

1. Review whether the unrelated legacy website deletions and modifications are intentional.
2. Fetch `origin/main` and reconcile the local/remote history without force-pushing.
3. Create a dedicated branch such as `codex/emr-cloud-build`.
4. Stage only the approved EMR allowlist used by `scripts/package-release.sh`.
5. Confirm that `git diff --cached` contains no patient database, secret, backup, `.env`, release ZIP, or unrelated website content.
6. Commit and push the dedicated branch.
7. Open a pull request and require the **EMR verification** workflow to pass before merge.

Do not push directly to `main` until branch protection, required reviews, and secret scanning are enabled in the GitHub repository settings.
