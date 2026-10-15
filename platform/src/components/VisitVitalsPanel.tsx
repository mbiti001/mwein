"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { measuredVitalFields, type MeasuredValues } from "@/lib/measured-vitals";
import { ApiRequestError, jsonRequest } from "@/lib/client-http";
import { useVitalsDraftGuard } from "./useVitalsDraftGuard";
type Measurement = { id: string; measuredAt: string; recordedAt: string; values: MeasuredValues; note: string | null; recordedBy: { displayName: string } };
type History = { measurements: Measurement[]; truncated: boolean };
export default function VisitVitalsPanel({ visitId, capture = false, onUse, useDisabled = false }: { visitId: string; capture?: boolean; onUse?: (values: MeasuredValues, measurementId: string) => void; useDisabled?: boolean }) {
  const [records, setRecords] = useState<Measurement[]>([]), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0), [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(false);
  const attempt = useRef<string | null>(null), mounted = useRef(true);
  const draft = useVitalsDraftGuard();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError("");
    jsonRequest<History>(`/api/visits/${visitId}/vitals`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setRecords(data.measurements); setTruncated(data.truncated); }
    }).catch(error => { if (!controller.signal.aborted) setLoadError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [visitId, refresh]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (draft.pending.current) return;
    const form = event.currentTarget, data = new FormData(form);
    const values = Object.fromEntries(measuredVitalFields.filter(field => String(data.get(field.key) ?? "").trim() !== "").map(field => [field.key, Number(data.get(field.key))]));
    const body = attempt.current || JSON.stringify({ requestKey: crypto.randomUUID(), measuredAt: new Date(String(data.get("measuredAt")) + ":00+03:00").toISOString(), values, note: data.get("note") || undefined });
    attempt.current = body; draft.pending.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await jsonRequest<{ measurement: Measurement }>(`/api/visits/${visitId}/vitals`, { method: "POST", body });
      draft.dirty.current = false; attempt.current = null;
      if (!mounted.current) return;
      form.reset(); setRetry(false);
      setRecords(current => [result.measurement, ...current.filter(record => record.id !== result.measurement.id)]);
      setRefresh(value => value + 1); setMessage("Vitals saved to this visit. Clinical triage and visit priority are unchanged.");
    } catch (error) {
      if (!mounted.current) return;
      const uncertain = !(error instanceof ApiRequestError) || error.status === 0 || error.status >= 500;
      setRetry(uncertain); if (!uncertain) attempt.current = null;
      setError((error as Error).message + (uncertain ? " Retry the same save to confirm its result; your entries are retained." : ""));
    } finally { draft.pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="card recordedVitals" aria-label="Recorded vital measurements"><h2>Recorded vital measurements</h2><p>Only enter measurements actually taken. Recording vitals does not complete clinical triage. Alert clinical staff promptly if the patient appears unwell.</p>
    {error && <div role="alert" className="alert">{error}</div>}{message && <p role="status">{message}</p>}
    {capture && <form onSubmit={save} onChange={() => { draft.dirty.current = true; }} className="dataForm"><fieldset className="wide vitalGrid" disabled={busy || retry}><legend>Measured values</legend><p className="wide">Leave unmeasured values blank. Nothing is assumed normal.</p>{measuredVitalFields.map(field => <label key={field.key}>{field.label}<input name={field.key} type="number" min={field.min} max={field.max} step={field.step} /></label>)}</fieldset>
      <label>Measured at (Nairobi)<input type="datetime-local" name="measuredAt" required defaultValue={new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 16)} disabled={busy || retry} /></label>
      <label>Measurement or correction note<input name="note" maxLength={500} disabled={busy || retry} /></label><button className="primary" disabled={busy}>{busy ? "Saving measurements…" : retry ? "Retry same measurement save" : "Save measured vitals"}</button>
    </form>}
    {loading && <p role="status">Loading recorded measurements…</p>}
    {loadError && <div role="alert" className="alert">Measurement history could not refresh. {records.length > 0 ? "The displayed sets are the last confirmed records." : "No history is confirmed as loaded."} <button className="secondary" onClick={() => setRefresh(value => value + 1)}>Retry measurement history</button></div>}
    {!loading && !loadError && !records.length && <p>No recorded measurements for this visit.</p>}
    <div className="measurementHistory">{records.map((record, index) => <article className="measurementSet" key={record.id}>
      <header className="measurementHeading"><h3>{index === 0 ? "Latest recorded set" : "Earlier recorded set"}</h3><div><p>{record.note?.startsWith("Completed from set ") ? "Missing values completed " : "Measured "}<time dateTime={record.measuredAt}>{new Date(record.measuredAt).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" })}</time> Nairobi</p><p>Recorded by {record.recordedBy.displayName}</p></div></header>
      <dl className="measurementValues">{measuredVitalFields.map(field => <div className={record.values[field.key] == null ? "unmeasured" : undefined} key={field.key}><dt>{field.label}</dt><dd>{record.values[field.key] ?? "Not recorded"}</dd></div>)}</dl>
      {record.note && <p className="measurementNote"><strong>Note:</strong> {record.note}</p>}
      {index === 0 && onUse && <button type="button" className="secondary" disabled={useDisabled || loading || !!loadError} onClick={() => onUse(record.values, record.id)}>Use recorded measurements in triage</button>}
    </article>)}</div>
    {truncated && <p>Showing the 50 most recently recorded measurement sets. Older sets remain stored.</p>}
  </section>;
}
