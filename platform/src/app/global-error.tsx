"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><main style={{ maxWidth: 640, margin: "10vh auto", padding: 32, fontFamily: "system-ui" }} role="alert">
    <title>Mwein HMIS · unavailable</title><h1>Mwein HMIS is temporarily unavailable</h1>
    <p>Do not assume any unfinished save succeeded. Retry once, then follow the facility downtime procedure if the problem remains.</p>
    <p>Support reference: <code>{error.digest || "global-error"}</code></p>
    <button onClick={reset}>Try again</button>
  </main></body></html>;
}
