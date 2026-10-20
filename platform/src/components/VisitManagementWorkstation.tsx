"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { jsonRequest } from "@/lib/client-http";
import type { CancellationWorklistResponse, CancellationWorklistVisit } from "@/lib/visit-cancellation-worklist";

export default function VisitManagementWorkstation({ onCancel, refreshKey, timeZone }: {
  onCancel: (visit: CancellationWorklistVisit) => void;
  refreshKey: number;
  timeZone: string;
}) {
  const [query, setQuery] = useState("");
  const [visits, setVisits] = useState<CancellationWorklistVisit[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const moreRequest = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setLoadingMore(false);
    moreRequest.current = false;
    setVisits([]);
    setNextCursor(null);
    setError("");
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim() });
      jsonRequest<CancellationWorklistResponse>("/api/visits/cancellation-worklist?" + params, {
        signal: controller.signal, cache: "no-store",
      }).then(result => {
        if (!controller.signal.aborted && current === generation.current) {
          setVisits(result.visits);
          setNextCursor(result.nextCursor);
        }
      }).catch(reason => {
        if (!controller.signal.aborted && current === generation.current) setError((reason as Error).message);
      }).finally(() => {
        if (!controller.signal.aborted && current === generation.current) setLoading(false);
      });
    }, query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, refreshKey, reload]);

  async function loadMore() {
    if (!nextCursor || loading || moreRequest.current) return;
    const current = generation.current;
    moreRequest.current = true;
    setLoadingMore(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query.trim(), cursor: nextCursor });
      const result = await jsonRequest<CancellationWorklistResponse>("/api/visits/cancellation-worklist?" + params, { cache: "no-store" });
      if (current === generation.current) {
        setVisits(previous => [...new Map([...previous, ...result.visits].map(visit => [visit.id, visit])).values()]);
        setNextCursor(result.nextCursor);
      }
    } catch (reason) {
      if (current === generation.current) setError((reason as Error).message);
    } finally {
      if (current === generation.current) { setLoadingMore(false); moreRequest.current = false; }
    }
  }

  return <>
    <header>
      <div><p className="eyebrow">Patient flow</p><h1>Visits</h1>
        <p>Find an open visit across all service points. Review cancellation for duplicate, unattended or unprocessed visits.</p>
      </div>
      <Button variant="secondary" onClick={() => setReload(value => value + 1)} disabled={loading || loadingMore}>Refresh active visits</Button>
    </header>
    <section className="card visitManagement" aria-label="Active visits">
      <div className="queueTools">
        <label>Find an active visit
          <input type="search" maxLength={100} autoComplete="off" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Patient name, patient number, visit number or clinic" />
        </label>
        <span>Oldest visits first</span>
      </div>
      <p className="visitManagementHelp">Cancellation checks clinical work and billing before any change. Visits with delivered care need the clinical discharge or billing workflow.</p>
      {error && <div className="alert" role="alert">
        <p>{error}</p>
        <Button variant="secondary" onClick={() => nextCursor ? void loadMore() : setReload(value => value + 1)}>Retry</Button>
      </div>}
      {loading ? <p role="status">Loading active visits…</p> : <>
        <p role="status">{visits.length ? String(visits.length) + " active visits loaded" + (nextCursor ? " · more available" : "") : error ? "The active visit list is unavailable." : "No active visits found."}</p>
        <ul className="visitManagementList">
          {visits.map(visit => <li key={visit.id} className="visitManagementRow" aria-label={visit.patient.fullName + " · " + visit.visitNumber}>
            <div className="visitManagementIdentity">
              <strong>{visit.patient.fullName}</strong>
              <span>{visit.patient.patientNumber} · {visit.visitNumber}</span>
              <small>{visit.clinic} · {visit.priority.toLowerCase()}</small>
            </div>
            <div className="visitManagementState">
              <strong>{visit.status.replaceAll("_", " ").toLowerCase()}</strong>
              <time dateTime={visit.arrivedAt}>Opened {new Date(visit.arrivedAt).toLocaleString("en-KE", {
                timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
              })}</time>
              {visit.clinicallyClosedAt && <small>Clinical closure recorded</small>}
            </div>
            <Button variant="secondary" className="cancelVisitAction" onClick={() => onCancel(visit)}>Cancel visit</Button>
          </li>)}
        </ul>
        {nextCursor && <div className="visitManagementMore">
          <Button variant="secondary" pending={loadingMore} pendingLabel="Loading…" onClick={() => void loadMore()}>Load more visits</Button>
        </div>}
      </>}
    </section>
  </>;
}
