import type { ReleaseIdentity } from "@/lib/release";

export default function BuildStamp({ release }: { release: ReleaseIdentity }) {
  return <footer className="buildStamp" aria-label="Application build">
    <details>
      <summary>Mwein {release.version} · Build {release.shortCommit === "local" ? "local development" : release.shortCommit}</summary>
      <dl>
        <div><dt>Source</dt><dd><code>{release.commit}</code></dd></div>
        <div><dt>Hosting environment</dt><dd>{release.environment}</dd></div>
        {release.branch && <div><dt>Branch</dt><dd>{release.branch}</dd></div>}
        {release.deployment && <div><dt>Deployment</dt><dd><code>{release.deployment}</code></dd></div>}
      </dl>
      <p>Include this version and build when reporting an issue.</p>
    </details>
  </footer>;
}
