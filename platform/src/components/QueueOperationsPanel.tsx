"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { jsonRequest } from "@/lib/client-http";
import { isWaitingOverdue } from "@/lib/service-points";
import { operationalServicePoints, servicePointPermission, type OperationalServicePoint } from "@/lib/queue-operations";

type QueueScreen = "triage" | "consultation" | "diagnostics" | "imaging" | "pharmacy" | "billing";
type Entry = {
  id: string;
  servicePoint: OperationalServicePoint;
  priority: string;
  status: string;
  enteredAt: string;
  calledAt?: string | null;
  startedAt?: string | null;
  durationMinutes?: number;
  visit: { id?: string; visitNumber: string; clinic?: string; patient: { patientNumber: string; fullName: string } };
};
type Control = { servicePoint: OperationalServicePoint; paused: boolean; pauseReason?: string | null; pausedAt?: string | null; targetMinutes: number };
type QueueData = { entries: Entry[]; controls: Control[]; history: Entry[] };

const pointScreen: Record<OperationalServicePoint, QueueScreen> = {
  TRIAGE: "triage",
  CONSULTATION: "consultation",
  LABORATORY: "diagnostics",
  IMAGING: "imaging",
  PHARMACY: "pharmacy",
  BILLING: "billing",
};

function waitMinutes(entry: Entry) {
  return Math.max(0, Math.floor((Date.now() - new Date(entry.enteredAt).getTime()) / 60_000));
}

export default function QueueOperationsPanel({
  permissions,
  onOpenTask,
  onUpdated,
}: {
  permissions: string[];
  onOpenTask: (screen: QueueScreen, visitId: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const manageable = useMemo(() => permissions.includes("admin.dashboard") ? [...operationalServicePoints] : operationalServicePoints.filter((point) => permissions.includes(servicePointPermission[point])), [permissions]);
  const [selectedPoint, setSelectedPoint] = useState<OperationalServicePoint>(manageable[0] || "TRIAGE");
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [transferId, setTransferId] = useState<string | null>(null);

  const load = useCallback(async () => setData(await jsonRequest<QueueData>("/api/queues")), []);
  useEffect(() => {
    if (!manageable.length) return;
    void load().catch((reason) => setError((reason as Error).message));
    const refresh = () => document.visibilityState === "visible" && void load().catch(() => undefined);
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load, manageable.length]);

  if (!manageable.length) return null;
  const entries = data?.entries.filter((entry) => entry.servicePoint === selectedPoint) || [];
  const control = data?.controls.find((item) => item.servicePoint === selectedPoint);
  const canManagePoint = permissions.includes(servicePointPermission[selectedPoint]);

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await jsonRequest("/api/queues", { method: "POST", body: JSON.stringify(body) });
      setNotice(success); setTransferId(null); await Promise.all([load(), onUpdated()]);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function transfer(event: FormEvent<HTMLFormElement>, entry: Entry) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void act({ action: "TRANSFER", queueEntryId: entry.id, targetServicePoint: form.get("targetServicePoint"), reason: form.get("reason") }, `${entry.visit.patient.fullName} transferred.`);
  }

  return <section className="card queueOperations">
    <div className="cardHead"><div><h2>Queue control</h2><p>Call in urgency order, record service start, transfer with a reason, or pause one service point.</p></div><span className={`badge ${control?.paused ? "rose" : "green"}`}>{control?.paused ? "PAUSED" : "OPEN"}</span></div>
    {error && <div className="alert" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <nav className="workspaceTabs" aria-label="Queue service points">{manageable.map((point) => <button type="button" className={selectedPoint === point ? "active" : ""} onClick={() => { setSelectedPoint(point); setTransferId(null); setError(""); }} key={point}>{point.replaceAll("_", " ")}</button>)}</nav>
    <div className="queueControlActions">
      {permissions.includes("admin.dashboard") && <form className="inlineForm" onSubmit={event => { event.preventDefault(); const targetMinutes = new FormData(event.currentTarget).get("targetMinutes"); void act({ action: "SET_TARGET", servicePoint: selectedPoint, targetMinutes }, `${selectedPoint.replaceAll("_", " ")} target updated.`); }}><label>Routine target (minutes)<input name="targetMinutes" type="number" min="5" max="480" defaultValue={control?.targetMinutes || 30} required/></label><button className="secondary" disabled={busy}>Save target</button></form>}
      {canManagePoint && <>
      <button className="primary" type="button" disabled={busy || control?.paused} onClick={() => void act({ action: "CALL_NEXT", servicePoint: selectedPoint }, `Next ${selectedPoint.toLowerCase()} patient called.`)}>Call next patient</button>
      {control?.paused ? <button className="secondary" type="button" disabled={busy} onClick={() => void act({ action: "SET_PAUSED", servicePoint: selectedPoint, paused: false }, `${selectedPoint.replaceAll("_", " ")} resumed.`)}>Resume service</button> : <form className="inlineForm" onSubmit={(event) => { event.preventDefault(); const reason = new FormData(event.currentTarget).get("pauseReason"); void act({ action: "SET_PAUSED", servicePoint: selectedPoint, paused: true, reason }, `${selectedPoint.replaceAll("_", " ")} paused.`); }}><input name="pauseReason" minLength={5} maxLength={300} placeholder="Reason to pause this service" required/><button className="secondary" disabled={busy}>Pause</button></form>}
      </>}
    </div>
    {control?.paused && <p className="listHint"><strong>Pause reason:</strong> {control.pauseReason}</p>}
    <div className="queue compact">{entries.map((entry) => {
      const wait = waitMinutes(entry); const overdue = isWaitingOverdue(entry.priority, wait, control?.targetMinutes || 30);
      return <div className={`row taskRow ${entry.priority.toLowerCase()} ${overdue ? "overdue" : ""}`} key={entry.id}>
        <span className="dot"/><div><strong>{entry.visit.patient.fullName}</strong><small>{entry.visit.patient.patientNumber} · {entry.visit.visitNumber} · {entry.status.replaceAll("_", " ")}</small>{transferId === entry.id && <form className="queueTransfer" onSubmit={(event) => transfer(event, entry)}><select name="targetServicePoint" aria-label="Transfer destination" required defaultValue=""> <option value="" disabled>Select destination</option>{manageable.filter((point) => point !== entry.servicePoint).map((point) => <option value={point} key={point}>{point.replaceAll("_", " ")}</option>)}</select><input name="reason" minLength={5} maxLength={300} placeholder="Transfer reason" required/><button className="primary" disabled={busy}>Confirm transfer</button></form>}</div>
        <b>{entry.priority}</b><time>{overdue ? "OVERDUE · " : ""}{wait} min</time>
        {canManagePoint && overdue && <details><summary>Escalate overdue review</summary><form onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void act({ action: "ESCALATE", queueEntryId: entry.id, reason: fields.get("reason") }, "Escalation recorded. Contact the service lead; no automatic notification was sent."); }}><label>Reason and service lead contacted<input name="reason" required minLength={10} maxLength={500} /></label><button className="secondary" disabled={busy}>Record escalation</button></form></details>}
        <div className="appointmentActions">{canManagePoint && <>{entry.status !== "IN_PROGRESS" && <button type="button" className="primary" disabled={busy || control?.paused} onClick={() => void act({ action: "START", queueEntryId: entry.id }, `Service started for ${entry.visit.patient.fullName}.`)}>Start</button>}<button type="button" className="secondary" disabled={busy} onClick={() => setTransferId(transferId === entry.id ? null : entry.id)}>Transfer</button><button type="button" className="secondary" onClick={() => onOpenTask(pointScreen[entry.servicePoint], entry.visit.id!)}>Open task</button></>}</div>
      </div>;
    })}{!entries.length && <div className="empty"><strong>No patients at this service point</strong><p>New arrivals will appear automatically.</p></div>}</div>
    <details className="managementPanel"><summary><span><strong>Queue history</strong><small>Completed, transferred and cancelled entries from the last 24 hours</small></span><b>{data?.history.length || 0}</b></summary><div className="queue compact managementBody">{data?.history.slice(0, 20).map((entry) => <div className="row" key={entry.id}><span className="dot"/><div><strong>{entry.visit.patient.fullName}</strong><small>{entry.servicePoint.replaceAll("_", " ")} · {entry.status.replaceAll("_", " ")}</small></div><time>{entry.durationMinutes} min</time></div>)}</div></details>
  </section>;
}
