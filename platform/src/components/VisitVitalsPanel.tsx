"use client";
import { FormEvent, useEffect, useState } from "react";
import { measuredVitalFields, type MeasuredValues } from "@/lib/measured-vitals";
type Measurement = { id: string; measuredAt: string; recordedAt: string; values: MeasuredValues; note: string | null; recordedBy: { displayName: string } };
async function request(url: string, init?: RequestInit) { const response = await fetch(url, init); const data = await response.json(); if (!response.ok) throw new Error(data.reason || data.error || "Could not load measured vitals"); return data; }
export default function VisitVitalsPanel({ visitId, capture = false, onUse }: { visitId: string; capture?: boolean; onUse?: (values: MeasuredValues, measurementId: string) => void }) {
  const [records, setRecords] = useState<Measurement[]>([]), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0), [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setRecords([]); setError("");
    request(`/api/visits/${visitId}/vitals`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setRecords(data.measurements); setTruncated(data.truncated); } }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [visitId, refresh]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const values = Object.fromEntries(measuredVitalFields.filter(field => String(data.get(field.key) ?? "").trim() !== "").map(field => [field.key, Number(data.get(field.key))]));
    setBusy(true); setError(""); setMessage("");
    try {
      await request(`/api/visits/${visitId}/vitals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ measuredAt: new Date(String(data.get("measuredAt")) + ":00+03:00").toISOString(), values, note: data.get("note") || undefined }) });
      form.reset(); setRefresh(value => value + 1); setMessage("Vitals saved to this visit. Clinical triage and visit priority are unchanged.");
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="card" aria-label="Recorded vital measurements"><h2>Recorded vital measurements</h2><p>Only enter measurements actually taken. Recording vitals does not complete clinical triage. Alert clinical staff promptly if the patient appears unwell.</p>
    {error && <div role="alert" className="alert">{error}</div>}{message && <p role="status">{message}</p>}
    {capture && <form onSubmit={save} className="dataForm"><fieldset className="wide vitalGrid" disabled={busy}><legend>Measured values</legend><p className="wide">Leave unmeasured values blank. Nothing is assumed normal.</p>{measuredVitalFields.map(field => <label key={field.key}>{field.label}<input name={field.key} type="number" min={field.min} max={field.max} step={field.step} /></label>)}</fieldset>
      <label>Measured at (Nairobi)<input type="datetime-local" name="measuredAt" required defaultValue={new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 16)} disabled={busy} /></label>
      <label>Measurement or correction note<input name="note" maxLength={500} disabled={busy} /></label><button className="primary" disabled={busy}>Save measured vitals</button>
    </form>}
    {!records.length && <p>No recorded measurements loaded for this visit.</p>}
    {records.map((record, index) => <article key={record.id}><h3>{index === 0 ? "Latest recorded set" : "Earlier recorded set"}</h3><p>Measured {new Date(record.measuredAt).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" })} Nairobi · Recorded by {record.recordedBy.displayName}</p><div className="summaryGrid">{measuredVitalFields.filter(field => record.values[field.key] !== undefined).map(field => <div className="summaryLine" key={field.key}><strong>{field.label}</strong><span>{record.values[field.key]}</span></div>)}</div>{record.note && <p>{record.note}</p>}{index === 0 && onUse && <button type="button" className="secondary" onClick={() => onUse(record.values, record.id)}>Use recorded measurements in triage</button>}</article>)}
    {truncated && <p>Showing the 50 most recently recorded measurement sets. Older sets remain stored.</p>}
  </section>;
}
