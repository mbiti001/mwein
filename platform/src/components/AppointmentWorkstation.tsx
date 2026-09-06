"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { appointmentClinics } from "@/lib/appointments";
import { jsonRequest } from "@/lib/client-http";

type Patient = {
  id: string;
  patientNumber: string;
  fullName: string;
  sexAtBirth: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN";
  dateOfBirth?: string | null;
  estimatedAgeYears?: number | null;
  contacts: { value: string }[];
  consents?: { id: string }[];
};
type Appointment = {
  id: string;
  scheduledAt: string;
  clinic: string;
  status: string;
  notes?: string | null;
  reminderPreparedAt?: string | null;
  patient: Patient;
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  return jsonRequest<T>(url, options);
}

const kenyaInputTime = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() + 60 * 60 * 1000));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
};

export default function AppointmentWorkstation({
  onCheckIn,
}: {
  onCheckIn: (appointment: Appointment) => void;
}) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [matches, setMatches] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reminder, setReminder] = useState<{ contact: string; message: string } | null>(null);
  const [query, setQuery] = useState("");
  const visibleAppointments = useMemo(() => {
    const term = query.trim().toLowerCase();
    return appointments.filter(item => !term || `${item.patient.fullName} ${item.patient.patientNumber} ${item.clinic} ${item.status}`.toLowerCase().includes(term)).slice(0, 50);
  }, [appointments, query]);

  async function load() {
    setAppointments((await request<{ appointments: Appointment[] }>("/api/appointments")).appointments);
  }
  useEffect(() => { void load().catch((reason) => setError(reason.message)); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient) return setError("Select a patient first");
    setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const local = String(form.get("scheduledAt"));
      await request("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          patientId: patient.id,
          scheduledAt: `${local}:00+03:00`,
          clinic: form.get("clinic"),
          notes: form.get("notes") || undefined,
        }),
      });
      setNotice(`Appointment booked for ${patient.fullName}.`);
      setPatient(null); setMatches([]); event.currentTarget.reset(); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function update(id: string, status: "CANCELLED" | "NO_SHOW") {
    setBusy(true); setError("");
    try {
      await request(`/api/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function prepareReminder(id: string) {
    setBusy(true); setError(""); setReminder(null);
    try {
      const prepared = await request<{ contact: string; message: string }>(`/api/appointments/${id}/reminder`, { method: "POST" });
      setReminder(prepared); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <header><div><p className="eyebrow">Reception</p><h1>Appointments</h1><p>Book and manage upcoming clinic visits from one practical queue.</p></div></header>
      {error && <div className="alert">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      {reminder && <section className="card reminderPreview"><div className="cardHead"><div><h2>Reminder ready</h2><p>Send to {reminder.contact} using the facility&apos;s approved messaging channel.</p></div><button className="secondary" type="button" onClick={() => setReminder(null)}>Close</button></div><textarea value={reminder.message} rows={4} readOnly aria-label="Prepared appointment reminder" /><button className="primary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(reminder.message); setNotice("Reminder copied."); } catch { setError("Copy failed; select the reminder text manually."); } }}>Copy reminder</button></section>}
      <details className="card managementPanel"><summary><span><strong>Book appointment</strong><small>Open the booking form when needed</small></span><b>Open</b></summary><form className="dataForm managementBody" onSubmit={submit}>
        <div className="wide"><h2>Book appointment</h2><p>Search the existing patient register before selecting a clinic and time.</p></div>
        {patient ? (
          <div className="patientBanner wide"><div><strong>{patient.fullName}</strong><span>{patient.patientNumber}</span></div><button type="button" onClick={() => setPatient(null)}>Change patient</button></div>
        ) : (
          <label className="wide">Patient *<input placeholder="Name, patient number or phone" onChange={async (event) => {
            const query = event.target.value.trim();
            if (query.length < 2) return setMatches([]);
            try { setMatches((await request<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(query)}`)).patients); }
            catch (reason) { setError((reason as Error).message); }
          }} />
          {matches.map((match) => <button type="button" className="patientResult" key={match.id} onClick={() => { setPatient(match); setMatches([]); }}><strong>{match.fullName}</strong><span>{match.patientNumber}</span></button>)}</label>
        )}
        <label>Clinic *<select name="clinic">{appointmentClinics.map((clinic) => <option key={clinic}>{clinic}</option>)}</select></label>
        <label>Date and time *<input name="scheduledAt" type="datetime-local" min={kenyaInputTime()} defaultValue={kenyaInputTime()} required /></label>
        <label className="wide">Reception note<textarea name="notes" rows={2} maxLength={300} placeholder="Optional administrative note; do not record clinical history here" /></label>
        <button className="primary wide" disabled={busy}>{busy ? "Booking…" : "Book appointment"}</button>
      </form></details>
      <section className="card compact">
        <div className="cardHead"><div><h2>Upcoming appointments</h2><p>Today and the next 30 days.</p></div></div>
        <label className="listSearch">Search appointments<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Patient, number, clinic or status" /></label>
        <p className="listCount">Showing {visibleAppointments.length} of {appointments.length} appointments</p>
        {visibleAppointments.length ? <div className="queue">{visibleAppointments.map((appointment) => (
          <div className={`row appointmentRow ${appointment.status === "SCHEDULED" ? "" : "mutedRow"}`} key={appointment.id}>
            <span className="dot" /><div><strong>{appointment.patient.fullName}</strong><small>{appointment.patient.patientNumber} · {appointment.clinic}{appointment.notes ? ` · ${appointment.notes}` : ""}</small></div>
            <time>{new Date(appointment.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time>
            {appointment.status === "SCHEDULED" ? <div className="appointmentActions"><button className="primary" type="button" onClick={() => onCheckIn(appointment)}>Check in</button>{appointment.patient.consents?.length ? <button className="secondary" type="button" disabled={busy} onClick={() => void prepareReminder(appointment.id)}>{appointment.reminderPreparedAt ? "Reminder again" : "Reminder"}</button> : null}<button className="secondary" type="button" disabled={busy} onClick={() => void update(appointment.id, "CANCELLED")}>Cancel</button></div> : <b>{appointment.status.replaceAll("_", " ")}</b>}
          </div>
        ))}</div> : <div className="empty"><strong>{query ? "No matching appointments" : "No upcoming appointments"}</strong><p>{query ? "Try a different patient or clinic." : "Booked patients will appear here."}</p></div>}
      </section>
    </>
  );
}
