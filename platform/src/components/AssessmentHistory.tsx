"use client";

import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "@/lib/client-http";
import { AssessmentSnapshotFields, type AssessmentSnapshot } from "./AssessmentSnapshotFields";
import { RecordFields } from "./RecordFields";

type Snapshot = AssessmentSnapshot & {
  id: string; version: number; previousVersion: number | null;
  kind: "MIGRATION_BASELINE" | "DRAFT_SAVE";
  sourceCreatedAt: string; sourceUpdatedAt: string; capturedAt: string;
  recordedBy: { id: string; displayName: string } | null;
  sessionAttribution: "RECORDED" | "NOT_AVAILABLE";
};
type HistoryPage = {
  visitId: string; recordId: string; encounterId: string;
  items: Snapshot[]; hasMore: boolean; nextBeforeVersion: number | null;
};
type Identity = { fullName: string; patientNumber: string; visitNumber: string; clinic: string };

export function AssessmentHistory({ visitId, recordId, identity, facilityTimeZone }: {
  visitId: string; recordId: string; identity: Identity; facilityTimeZone: string;
}) {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [printSelected, setPrintSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Cursors only, not clinical snapshots: the viewer retains at most one page.
  const [cursors, setCursors] = useState<(number | null)[]>([null]);
  const request = useRef<AbortController | null>(null);
  const retryCursors = useRef<(number | null)[]>([null]);
  const selected = page?.items.find(item => item.id === selectedId);
  useEffect(() => () => request.current?.abort(), []);

  async function load(nextCursors: (number | null)[]) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    retryCursors.current = nextCursors;
    setBusy(true); setError(""); setPage(null); setSelectedId(""); setPrintSelected(false);
    const before = nextCursors.at(-1);
    const query = new URLSearchParams({ visitId, recordId });
    if (before != null) query.set("beforeVersion", String(before));
    try {
      const result = await jsonRequest<HistoryPage>(`/api/service-points/history?${query}`, { signal: controller.signal, cache: "no-store" });
      if (controller.signal.aborted) return;
      if (result.visitId !== visitId || result.recordId !== recordId || !Array.isArray(result.items) || result.items.length > 20)
        throw new Error("The history response does not match this assessment. Reload history.");
      setPage(result); setCursors(nextCursors);
    } catch (reason) { if (!controller.signal.aborted) setError((reason as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  function timestamp(value: string) {
    return value ? `${new Date(value).toLocaleString(undefined, { timeZone: facilityTimeZone })} (${facilityTimeZone})` : "Not recorded";
  }

  return <section className={`card assessmentHistory${printSelected && selected ? " historyPrintSelected" : ""}`} aria-label="Structured assessment history">
    <div className="noPrint">
      <h2>Structured assessment history</h2>
      <p>Review saved versions without changing your entries. Earlier values that were never captured cannot be recovered here.</p>
      <div className="assessmentHistoryControls">
        <button type="button" className="secondary" disabled={busy} onClick={() => void load([null])}>{page || error ? "Reload latest history" : "Load saved versions"}</button>
        {page && cursors.length > 1 && <button type="button" className="secondary" disabled={busy} onClick={() => void load(cursors.slice(0, -1))}>Newer versions</button>}
        {page?.hasMore && page.nextBeforeVersion != null && <button type="button" className="secondary" disabled={busy} onClick={() => void load([...cursors, page.nextBeforeVersion])}>Older versions</button>}
      </div>
      {busy && <p role="status">Loading saved versions…</p>}
      {error && <div role="alert"><p>Structured history unavailable. {error}</p><button type="button" className="secondary" onClick={() => void load(retryCursors.current)}>Retry history load</button></div>}
      {page && <>
        <p>{page.items.length ? `Showing ${page.items.length} retained versions on page ${cursors.length}, newest first.${page.hasMore ? " Older versions are available." : " No older retained versions on this page."}` : "No retained snapshots on this page. This does not establish that no earlier assessment existed."}</p>
        {page.items.length > 0 && <label>Saved version<select value={selectedId} onChange={event => { setSelectedId(event.target.value); setPrintSelected(false); }}>
          <option value="">Select a saved version to review</option>
          {page.items.map(item => <option key={item.id} value={item.id}>Version {item.version} · {item.kind === "MIGRATION_BASELINE" ? "Migration baseline" : "Saved assessment"} · {timestamp(item.sourceUpdatedAt)}</option>)}
        </select></label>}
      </>}
      {selected && <div className="assessmentHistoryControls">
        <label className="checkField"><input type="checkbox" checked={printSelected} onChange={event => setPrintSelected(event.target.checked)} />Use this version for printing</label>
        <button type="button" className="secondary" disabled={!printSelected} onClick={() => window.print()}>Print selected version</button>
        <p>{printSelected ? `Print target: retained version ${selected.version} only. Current assessment, narrative addenda and unsaved entries are excluded.` : "Print target: current saved assessment and loaded narrative addenda."}</p>
      </div>}
    </div>
    {selected && <article className="assessmentHistorySnapshot" aria-label={`Retained assessment version ${selected.version}`}>
      <h2>Retained assessment · version {selected.version}</h2>
      <div className="assessmentIdentity"><strong>{identity.fullName}</strong><span>{identity.patientNumber} · {identity.visitNumber} · {identity.clinic}</span></div>
      <p>This is one retained snapshot, not a complete visit record or a statement of current care. Unsaved entries and narrative addenda are excluded.</p>
      {selected.kind === "MIGRATION_BASELINE" && <p>Migration baseline: values retained when history capture began. Earlier revisions and the original recording session are not available.</p>}
      <RecordFields title="Version details" fields={[
        { label: "Version", value: selected.version }, { label: "Previous retained version", value: selected.previousVersion ?? "None retained" },
        { label: "Template", value: selected.templateVersion }, { label: "Capture type", value: selected.kind === "MIGRATION_BASELINE" ? "Migration baseline" : "Saved assessment" },
        { label: "Recorded by (current name)", value: selected.recordedBy?.displayName || "Recorder not available" }, { label: "Recorder reference", value: selected.recordedBy?.id || "Not available" },
        { label: "Source last saved", value: timestamp(selected.sourceUpdatedAt) }, { label: "Snapshot captured", value: timestamp(selected.capturedAt) },
        { label: "Source record created", value: timestamp(selected.sourceCreatedAt) }, { label: "Recording session", value: selected.sessionAttribution === "RECORDED" ? "Recorded" : "Not available" },
        { label: "Assessment reference", value: recordId }, { label: "Encounter reference", value: page?.encounterId || "Not available" },
        { label: "Snapshot reference", value: selected.id, wide: true },
      ]} />
      <AssessmentSnapshotFields snapshot={selected} />
    </article>}
  </section>;
}
