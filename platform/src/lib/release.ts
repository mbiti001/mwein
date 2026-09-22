export function releaseIdentity(environment: Record<string, string | undefined> = process.env) {
  const commit = environment.VERCEL_GIT_COMMIT_SHA || environment.GIT_COMMIT_SHA || environment.DEPLOYMENT_VERSION || "local";
  return {
    commit,
    shortCommit: commit === "local" ? commit : commit.slice(0, 12),
    environment: environment.VERCEL_ENV || environment.NODE_ENV || "local",
    application: "mwein-hmis-platform",
  };
}
