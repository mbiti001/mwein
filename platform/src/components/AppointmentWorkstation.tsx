"use client";

import { FormEvent, useRef, useState } from "react";
import { appointmentClinics, kenyaAppointmentInput, type AppointmentScope } from "@/lib/appointments";
import { jsonRequest } from "@/lib/client-http";
import { useWorklist } from "@/lib/use-worklist";

export type AppointmentPatientFocus = { id: string; patientNumber: string; fullName: string };
type Patient = AppointmentPatientFocus & { sexAtBirth: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN"; dateOfBirth?: string | null; estimatedAgeYears?: number | null; contacts: { value: string }[]; consents?: { id: string }[] };
type Appointment = { id: string; scheduledAt: string; clinic: string; status: string; notes?: string | null; reminderPreparedAt?: string | null; reminderDeliveries?: { id: string; status: string; destinationMasked: string }[]; patient: Patient };
const views: Record<AppointmentScope, { label: string; description: string }> = {
  today: { label: "Today", description: "All appointments for today in East Africa Time, including patients still waiting to check in." },
  upcoming: { label: "Upcoming", description: "Tomorrow through the next 30 days." },
  recall: { label: "Recall missed", description: "Missed appointments and scheduled times that have passed, from the last 90 days. Confirm attendance before marking a no-show." },
  all: { label: "All appointments", description: "The last 90 days and all bookings in the next 90 days." },
};
const dateTime = (value: string) => new Date(value).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });

export default function AppointmentWorkstation({ onCheckIn, initialPatient, initialAppointmentId }: { onCheckIn: (appointment: Appointment) => void; initialPatient?: AppointmentPatientFocus | null; initialAppointmentId?: string | null }) {
  const [patientFocus, setPatientFocus] = useState(initialPatient || null);
  const [scope, setScope] = useState<AppointmentScope>(initialPatient ? "recall" : "today");
  const [query, setQuery] = useState("");
  const [patientQuery, setPatientQuery] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [reminder, setReminder] = useState<{ contact: string; message: string } | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(initialAppointmentId || null);
  const list = useWorklist<{ appointments: Appointment[]; truncated: boolean }>(`/api/appointments?scope=${scope}${patientFocus ? `&patientId=${patientFocus.id}` : ""}`);
  const search = useWorklist<{ patients: Patient[] }>(!patient && patientQuery.trim().length >= 2 ? `/api/patients?q=${encodeURIComponent(patientQuery.trim())}` : null, 0, 250);
  const appointments = list.data?.appointments || [];
  const term = query.trim().toLowerCase();
  const shown = appointments.filter(item => `${item.patient.fullName} ${item.patient.patientNumber} ${item.clinic} ${item.status}`.toLowerCase().includes(term));

  async function save(operation: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(""); setNotice(""); setReminder(null);
    try { await operation(); }
    catch (reason) { setError((reason as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }

  function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient) return setError("Select a patient first");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void save(async () => {
      await jsonRequest("/api/appointments", { method: "POST", body: JSON.stringify({ patientId: patient.id, scheduledAt: `${form.get("scheduledAt")}:00+03:00`, clinic: form.get("clinic"), notes: form.get("notes") || undefined }) });
      setNotice(`Appointment booked for ${patient.fullName}.`);
      setPatient(null); setPatientQuery(""); setPatientFocus(null); setQuery(""); formElement.reset();
      if (scope === "all" && !patientFocus) await list.refresh(); else setScope("all");
    });
  }
  function reschedule(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void save(async () => {
      await jsonRequest(`/api/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({ action: "RESCHEDULE", scheduledAt: `${form.get("scheduledAt")}:00+03:00`, clinic: form.get("clinic"), reason: form.get("reason") }) });
      setNotice("Appointment rescheduled. A fresh reminder can be prepared if consent is current."); setRescheduleId(null);
      if (scope === "all") await list.refresh(); else setScope("all");
    });
  }
  const disabled = busy || list.loading || !list.data;
  return <>
    <header><div><p className="eyebrow">Reception</p><h1>Appointments</h1><p>Plan visits, check in arrivals and recall patients from one worklist. All times are EAT.</p></div><button className="secondary" disabled={busy || list.loading} onClick={() => void list.refresh()}>Refresh appointments</button></header>
    {error && <div className="alert" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {reminder && <section className="card reminderPreview"><div className="cardHead"><div><h2>Reminder ready</h2><p>Send to {reminder.contact} using the facility&apos;s approved messaging channel. Preparing does not send it.</p></div><button className="secondary" onClick={() => setReminder(null)}>Close</button></div><textarea value={reminder.message} rows={4} readOnly aria-label="Prepared appointment reminder" /><button className="primary" onClick={async () => { try { await navigator.clipboard.writeText(reminder.message); setNotice("Reminder copied."); } catch { setError("Copy failed; select the reminder text manually."); } }}>Copy reminder</button></section>}
    <details className="card managementPanel"><summary><span><strong>Book appointment</strong><small>Find the patient, then choose a clinic and time</small></span><b>Open</b></summary><form onSubmit={book}><fieldset className="dataForm managementBody worklistFieldset" disabled={busy}>
      <div className="wide"><h2>Book appointment</h2><p>Search the existing register to keep the visit linked to the correct patient.</p></div>
      {patient ? <div className="patientBanner wide"><div><strong>{patient.fullName}</strong><span>{patient.patientNumber}</span></div><button type="button" onClick={() => { setPatient(null); setPatientQuery(""); }}>Change patient</button></div> : <div className="wide"><label>Patient *<input value={patientQuery} onChange={event => setPatientQuery(event.target.value)} placeholder="Name, patient number or phone" autoComplete="off" /></label>{search.loading && <p role="status">Searching patients…</p>}{search.error && <p role="alert">{search.error}</p>}{search.data?.patients.map(match => <button type="button" className="patientResult" key={match.id} onClick={() => setPatient(match)}><strong>{match.fullName}</strong><span>{match.patientNumber}</span></button>)}{search.data && !search.data.patients.length && <p>No matching patients. Check the identifier or register the patient first.</p>}</div>}
      <label>Clinic *<select name="clinic">{appointmentClinics.map(clinic => <option key={clinic}>{clinic}</option>)}</select></label>
      <label>Date and time (EAT) *<input name="scheduledAt" type="datetime-local" min={kenyaAppointmentInput(new Date(Date.now() + 60_000))} defaultValue={kenyaAppointmentInput(new Date(Date.now() + 3_600_000))} required /></label>
      <label className="wide">Reception note<textarea name="notes" rows={2} maxLength={300} placeholder="Optional administrative note; do not record clinical history here" /></label>
      <button className="primary wide" disabled={busy || !patient}>{busy ? "Saving…" : "Book appointment"}</button>
    </fieldset></form></details>
    <section className="card compact" aria-label="Appointment worklist">
      <nav className="workspaceTabs" aria-label="Appointment lists">{Object.entries(views).map(([key, view]) => <button key={key} type="button" aria-pressed={scope === key} className={scope === key ? "active" : ""} disabled={busy} onClick={() => { setScope(key as AppointmentScope); setRescheduleId(null); setReminder(null); }}>{view.label}</button>)}</nav>
      <div className="cardHead"><div><h2>{scope === "today" ? "Today's appointments" : views[scope].label}</h2><p>{views[scope].description}</p></div></div>
      {patientFocus && <div className="patientBanner"><div><strong>{patientFocus.fullName}</strong><span>{patientFocus.patientNumber}</span></div><button className="secondary" disabled={busy} onClick={() => { setPatientFocus(null); setRescheduleId(null); }}>Show all patients</button></div>}
      <label className="listSearch">Search appointments<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Patient, number, clinic or status" /></label>
      {list.error && <div className="alert" role="alert">{list.error} Use Refresh appointments to try again.</div>}
      {list.loading && <p role="status">Loading appointments…</p>}
      {list.data && <><p className="listCount" role="status">Showing {shown.length} of {appointments.length} appointments{list.data.truncated ? ". The first 500 are shown; narrow the view to find more." : "."}{list.updatedAt && ` Updated ${dateTime(list.updatedAt.toISOString())} EAT.`}</p>
        <div className="queue">{shown.map(item => {
          const editable = ["SCHEDULED", "NO_SHOW"].includes(item.status);
          return <article className={`row appointmentRow ${item.status === "SCHEDULED" ? "" : "mutedRow"}`} key={item.id}>
            <span className="dot"/><div><strong>{item.patient.fullName}</strong><small>{item.patient.patientNumber} · {item.clinic}{item.notes ? ` · ${item.notes}` : ""}</small><span className="flowTaskState">{item.status === "COMPLETED" ? "Checked in" : item.status.replaceAll("_", " ")}</span>{item.reminderDeliveries?.[0] && <small>Latest reminder: {item.reminderDeliveries[0].status.toLowerCase()} · {item.reminderDeliveries[0].destinationMasked}</small>}
              {rescheduleId === item.id && editable && <form className="queueTransfer" onSubmit={event => reschedule(event, item.id)}><label>New clinic<select name="clinic" defaultValue={item.clinic}>{appointmentClinics.map(clinic => <option key={clinic}>{clinic}</option>)}</select></label><label>New date and time (EAT)<input name="scheduledAt" type="datetime-local" min={kenyaAppointmentInput(new Date(Date.now() + 60_000))} defaultValue={kenyaAppointmentInput(new Date(Date.now() + 3_600_000))} required /></label><label>Reason for rescheduling<input name="reason" minLength={5} maxLength={300} required /></label><button className="primary" disabled={disabled}>Save new time</button><button type="button" className="secondary" disabled={busy} onClick={() => setRescheduleId(null)}>Keep current time</button></form>}
            </div><time>{dateTime(item.scheduledAt)} EAT</time>
            <div className="appointmentActions">{item.status === "SCHEDULED" && <button className="primary" disabled={disabled} onClick={() => onCheckIn(item)}>Check in</button>}{item.status === "SCHEDULED" && Boolean(item.patient.consents?.length) && <button className="secondary" disabled={disabled} onClick={() => void save(async () => { const prepared = await jsonRequest<{ contact: string; message: string }>(`/api/appointments/${item.id}/reminder`, { method: "POST" }); await list.refresh(); setReminder(prepared); })}>Prepare reminder</button>}{editable && <button className="secondary" disabled={disabled} onClick={() => setRescheduleId(rescheduleId === item.id ? null : item.id)}>Reschedule</button>}{item.status === "SCHEDULED" && <>{new Date(item.scheduledAt).getTime() <= Date.now() && <button className="secondary" disabled={disabled} onClick={() => void save(async () => { await jsonRequest(`/api/appointments/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "NO_SHOW" }) }); setNotice("Appointment marked as missed."); await list.refresh(); })}>Mark no-show</button>}<button className="secondary" disabled={disabled} onClick={() => void save(async () => { await jsonRequest(`/api/appointments/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "CANCELLED" }) }); setNotice("Appointment cancelled."); await list.refresh(); })}>Cancel</button></>}</div>
          </article>;
        })}</div>{!shown.length && <div className="empty"><strong>{query ? "No matching appointments" : "No appointments in this view"}</strong><p>{query ? "Try another patient, clinic or status." : "Choose another date view or book an appointment."}</p></div>}
      </>}
    </section>
  </>;
}
