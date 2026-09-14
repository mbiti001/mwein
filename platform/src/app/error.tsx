"use client";

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="login"><section className="formCard" role="alert">
    <p className="eyebrow">Workspace interrupted</p><h1>We could not open this view</h1>
    <p>No save is being reported as complete. Try loading the view again; if the problem continues, give support reference <code>{error.digest || "client-error"}</code>.</p>
    <button className="primary" onClick={reset}>Try again</button>
  </section></main>;
}
