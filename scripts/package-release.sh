#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/package.json', 'utf8')).version")
ARCHIVE="$ROOT/dist/mwein-cloud-emr-v$VERSION.zip"

cd "$ROOT"
npm test
mkdir -p dist

zip -q -FS "$ARCHIVE" \
  .dockerignore \
  .env.example \
  .github/workflows/ci.yml \
  .gitignore \
  CLOUD_DEPLOY_CHECKLIST.md \
  DEPLOYMENT.md \
  Dockerfile \
  EMR_IMPLEMENTATION_PLAN.md \
  GITHUB_PREPARATION.md \
  Mwein-Cloud-EMR.code-workspace \
  PRODUCTION_READINESS.md \
  README.md \
  SECURITY.md \
  compose.production.yml \
  health.json \
  index.html \
  manifest.webmanifest \
  package.json \
  robots.txt \
  scripts/backup.js \
  scripts/package-release.sh \
  scripts/verify-backup.js \
  server.js \
  service-worker.js \
  test/api.test.js

if unzip -Z1 "$ARCHIVE" | grep -Eq '(^|/)(data|secrets|node_modules)(/|$)|(^|/)\.env$|\.sqlite($|-)'; then
  echo "Release validation failed: private runtime content entered the archive" >&2
  exit 1
fi

echo "Cloud source bundle created: $ARCHIVE"
