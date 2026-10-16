"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useWorklist } from "@/lib/use-worklist";
import { careServiceForClinic } from "@/lib/care-service-points";
import { jsonRequest } from "@/lib/client-http";
import { isWaitingOverdue } from "@/lib/service-points";
import { operationalServicePoints, servicePointPermission, type OperationalServicePoint } from "@/lib/queue-operations";

type QueueScreen = "triage" | "consultation" | "diagnostics" | "imaging" | "pharmacy" | "billing" | "servicePoints";
type Entry = {
  id: string;
  servicePoint: OperationalServicePoint;
  priority: string;
  status: string;
  enteredAt: string;
  calledAt?: string | null;
  startedAt?: string | null;
  durationMinutes?: number;
  visit: { id?: string; visitNumber: string; clinic?: string; clinicallyClosedAt?: string | null; status?: string; patient: { patientNumber: string; fullName: string } };
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
  const { data, loading, error: loadError, refresh: load, updatedAt } = useWorklist<QueueData>(manageable.length ? "/api/queues" : null, 15_000);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [transferId, setTransferId] = useState<string | null>(null);
  const saving = useRef(false);

  if (!manageable.length) return null;
  const entries = data?.entries.filter((entry) => entry.servicePoint === selectedPoint) || [];
  const history = data?.history.filter((entry) => entry.servicePoint === selectedPoint) || [];
  const control = data?.controls.find((item) => item.servicePoint === selectedPoint);
  const canManagePoint = permissions.includes(servicePointPermission[selectedPoint]);
  const unavailable = busy || loading || !data || !control;

  async function act(body: Record<string, unknown>, success: string) {
    if (saving.current || unavailable) return;
    saving.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      await jsonRequest("/api/queues", { method: "POST", body: JSON.stringify(body) });
      setNotice(success); setTransferId(null); await Promise.all([load(), onUpdated()]);
    } catch (reason) { setError((reason as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }

  function transfer(event: FormEvent<HTMLFormElement>, entry: Entry) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void act({ action: "TRANSFER", queueEntryId: entry.id, targetServicePoint: form.get("targetServicePoint"), reason: form.get("reason") }, `${entry.visit.patient.fullName} transferred.`);
  }

  return <section className="card queueOperations">
    <div className="cardHead"><div><h2>Queue control</h2><p>Call in urgency order, record service start, transfer with a reason, or pause one service point.</p></div><span className={`badge ${!control ? "" : control.paused ? "rose" : "green"}`}>{!control ? "STATUS UNAVAILABLE" : control.paused ? "PAUSED" : "OPEN"}</span><button className="secondary" disabled={busy || loading} onClick={() => void load()}>Refresh queue</button></div>
    {loadError && <div className="alert" role="alert">{loadError} Queue actions are unavailable until a successful refresh.</div>}
    {loading && <p role="status">Updating queue…</p>}
    {updatedAt && <p className="listHint">Updated {updatedAt.toLocaleTimeString("en-KE", { timeZone: "Africa/Nairobi" })} EAT</p>}
    {error && <div className="alert" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <nav className="workspaceTabs" aria-label="Queue service points">{manageable.map((point) => <button type="button" className={selectedPoint === point ? "active" : ""} onClick={() => { setSelectedPoint(point); setTransferId(null); setError(""); }} key={point}>{point.replaceAll("_", " ")}</button>)}</nav>
    <fieldset className="queueControlActions worklistFieldset" disabled={unavailable}>
      {permissions.includes("admin.dashboard") && <form className="inlineForm" onSubmit={event => { event.preventDefault(); const targetMinutes = new FormData(event.currentTarget).get("targetMinutes"); void act({ action: "SET_TARGET", servicePoint: selectedPoint, targetMinutes }, `${selectedPoint.replaceAll("_", " ")} target updated.`); }}><label>Routine target (minutes)<input key={`${selectedPoint}:${control?.targetMinutes}`} name="targetMinutes" type="number" min="5" max="480" defaultValue={control?.targetMinutes || 30} required/></label><button className="secondary" disabled={unavailable}>Save target</button></form>}
      {canManagePoint && <>
      <button className="primary" type="button" disabled={unavailable || control?.paused} onClick={() => void act({ action: "CALL_NEXT", servicePoint: selectedPoint }, `Next ${selectedPoint.toLowerCase()} patient called.`)}>Call next patient</button>
      {control?.paused ? <button className="secondary" type="button" disabled={unavailable} onClick={() => void act({ action: "SET_PAUSED", servicePoint: selectedPoint, paused: false }, `${selectedPoint.replaceAll("_", " ")} resumed.`)}>Resume service</button> : <form className="inlineForm" onSubmit={(event) => { event.preventDefault(); const reason = new FormData(event.currentTarget).get("pauseReason"); void act({ action: "SET_PAUSED", servicePoint: selectedPoint, paused: true, reason }, `${selectedPoint.replaceAll("_", " ")} paused.`); }}><input name="pauseReason" minLength={5} maxLength={300} placeholder="Reason to pause this service" required/><button className="secondary" disabled={unavailable}>Pause</button></form>}
      </>}
    </fieldset>
    {control?.paused && <p className="listHint"><strong>Pause reason:</strong> {control.pauseReason}</p>}
    {!!entries.length && <table className="workflowTable queueWorkTable" role="table">
      <caption>{selectedPoint.replaceAll("_", " ")} · {entries.length} active queue entries</caption>
      <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Patient / visit</th><th scope="col" role="columnheader">Status / priority</th><th scope="col" role="columnheader">Time in queue</th><th scope="col" role="columnheader" className="noPrint">Actions</th></tr></thead>
      <tbody role="rowgroup">{entries.map((entry) => {
      const wait = waitMinutes(entry); const overdue = isWaitingOverdue(entry.priority, wait, control?.targetMinutes || 30);
      return <tr role="row" className={overdue ? "workflowOverdue" : undefined} key={entry.id}>
        <th scope="row" role="rowheader" data-label="Patient / visit"><strong>{entry.visit.patient.fullName}</strong><span className="workflowCellMeta">{entry.visit.patient.patientNumber}</span><span className="workflowCellMeta">{entry.visit.visitNumber}</span></th>
        <td role="cell" data-label="Status / priority"><strong>{entry.status.replaceAll("_", " ")}</strong><span className="workflowCellMeta">{entry.priority}</span>{(entry.visit.clinicallyClosedAt || entry.visit.status === "DISCHARGED") && <span className="workflowCellMeta">Closed visit · transfer unavailable</span>}</td>
        <td role="cell" data-label="Time in queue"><strong>{wait} min</strong>{overdue && <span className="workflowCellMeta">OVERDUE</span>}</td>
        <td role="cell" data-label="Actions" className="noPrint">
          {canManagePoint ? <>
            <div className="workflowRowActions">{entry.status !== "IN_PROGRESS" && <button type="button" className="primary" disabled={unavailable || control?.paused} onClick={() => void act({ action: "START", queueEntryId: entry.id }, `Service started for ${entry.visit.patient.fullName}.`)}>Start</button>}<button type="button" className="secondary" aria-expanded={transferId === entry.id} disabled={unavailable || Boolean(entry.visit.clinicallyClosedAt) || entry.visit.status === "DISCHARGED"} onClick={() => setTransferId(transferId === entry.id ? null : entry.id)}>Transfer</button><button type="button" className="secondary" disabled={unavailable} onClick={() => onOpenTask(entry.servicePoint === "CONSULTATION" && careServiceForClinic(entry.visit.clinic || "") ? "servicePoints" : pointScreen[entry.servicePoint], entry.visit.id!)}>Open task</button></div>
            {transferId === entry.id && <form className="workflowRowForm" onSubmit={(event) => transfer(event, entry)}><label>Transfer destination<select name="targetServicePoint" required defaultValue=""><option value="" disabled>Select destination</option>{manageable.filter((point) => point !== entry.servicePoint && permissions.includes(servicePointPermission[point])).map((point) => <option value={point} key={point}>{point.replaceAll("_", " ")}</option>)}</select></label><label>Transfer reason<input name="reason" minLength={5} maxLength={300} required/></label><button className="primary" disabled={unavailable}>Confirm transfer</button></form>}
            {overdue && <details className="workflowRowDetail"><summary>Escalate overdue review</summary><form className="workflowRowForm" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void act({ action: "ESCALATE", queueEntryId: entry.id, reason: fields.get("reason") }, "Escalation recorded. Contact the service lead; no automatic notification was sent."); }}><label>Reason and service lead contacted<input name="reason" required minLength={10} maxLength={500} /></label><button className="secondary" disabled={unavailable}>Record escalation</button></form></details>}
          </> : <span className="workflowCellMeta">Service permission required</span>}
        </td>
      </tr>;
    })}</tbody></table>}
    {data && !loading && !entries.length && <div className="empty"><strong>No patients at this service point</strong><p>New arrivals will appear automatically.</p></div>}
    <details className="managementPanel queueHistory"><summary><span><strong>Queue history</strong><small>Completed, transferred and cancelled entries from the last 24 hours</small></span><b>{history.length}</b></summary><div className="managementBody">
      {!!history.length && <table className="workflowTable" role="table"><caption>{selectedPoint.replaceAll("_", " ")} · Showing {Math.min(history.length, 20)} of {history.length} returned history entries</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Patient / visit</th><th scope="col" role="columnheader">Outcome</th><th scope="col" role="columnheader">Duration</th></tr></thead><tbody role="rowgroup">{history.slice(0, 20).map(entry => <tr role="row" key={entry.id}><th scope="row" role="rowheader" data-label="Patient / visit"><strong>{entry.visit.patient.fullName}</strong><span className="workflowCellMeta">{entry.visit.patient.patientNumber}</span><span className="workflowCellMeta">{entry.visit.visitNumber}</span></th><td role="cell" data-label="Outcome">{entry.status.replaceAll("_", " ")}</td><td role="cell" data-label="Duration">{entry.durationMinutes == null ? "Not recorded" : `${entry.durationMinutes} min`}</td></tr>)}</tbody></table>}
      {data && !history.length && <p>No returned history for this service point.</p>}
    </div></details>
  </section>;
}
