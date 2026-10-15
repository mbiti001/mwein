import packageMetadata from "../../package.json";

export function releaseIdentity(environment: Record<string, string | undefined> = process.env) {
  const commit = environment.VERCEL_GIT_COMMIT_SHA || environment.GIT_COMMIT_SHA || environment.DEPLOYMENT_VERSION || "local";
  return {
    version: packageMetadata.version,
    commit,
    shortCommit: commit === "local" ? commit : commit.slice(0, 12),
    environment: environment.VERCEL_ENV || environment.NODE_ENV || "local",
    branch: environment.VERCEL_GIT_COMMIT_REF || environment.RELEASE_BRANCH || null,
    deployment: environment.VERCEL_DEPLOYMENT_ID || null,
    application: "mwein-hmis-platform",
  };
}

export type ReleaseIdentity = ReturnType<typeof releaseIdentity>;
