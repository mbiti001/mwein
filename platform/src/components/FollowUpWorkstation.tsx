"use client";

import { useState } from "react";
import { useWorklist } from "@/lib/use-worklist";
import type { FollowUpData, FollowUpPatient } from "@/lib/follow-ups";

const groups = { appointments: "Missed appointments", referrals: "Referral feedback", specialty: "Specialty reviews", clinical: "Clinical follow-ups" };
type Group = keyof typeof groups;
const day = (date: string) => new Date(date).toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
const displayDate = (date: string) => new Date(date).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" });

export default function FollowUpWorkstation({ permissions, onAppointments, onReferral, onRecord }: {
  permissions: string[];
  onAppointments: (patient: FollowUpPatient, appointmentId: string) => void;
  onReferral: (reference: string) => void;
  onRecord: (visitId: string) => void;
}) {
  const { data, error, loading, refresh } = useWorklist<FollowUpData>("/api/follow-ups");
  const [group, setGroup] = useState<Group | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [due, setDue] = useState("ALL");
  const rows = data ? [
    ...data.worklists.appointments.map(item => ({ key: `appointment:${item.id}`, group: "appointments" as const, patient: item.patient, date: item.scheduledAt, detail: `${item.clinic} · ${item.status.replaceAll("_", " ")}`, action: permissions.includes("visit.create") ? () => onAppointments(item.patient, item.id) : undefined, actionLabel: "Review appointment" })),
    ...data.worklists.referrals.map(item => ({ key: `referral:${item.id}`, group: "referrals" as const, patient: item.patient, date: item.updatedAt, detail: `${item.referralNumber} · ${item.receivingFacility} · ${item.status}`, action: permissions.includes("encounter.write") && permissions.includes("referral.read") ? () => onReferral(item.referralNumber) : undefined, actionLabel: "Review referral" })),
    ...data.worklists.specialty.map(item => ({ key: `specialty:${item.id}`, group: "specialty" as const, patient: item.patient, date: item.followUpAt, detail: `${item.servicePoint.replaceAll("_", " ")} · ${item.visitNumber}`, action: permissions.includes("clinical.summary.read") ? () => onRecord(item.visitId) : undefined, actionLabel: "Review clinical record" })),
    ...data.worklists.clinical.map(item => ({ key: `clinical:${item.id}`, group: "clinical" as const, patient: item.patient, date: item.followUpAt, detail: `${item.clinic} · ${item.visitNumber}`, action: permissions.includes("clinical.summary.read") ? () => onRecord(item.visitId) : undefined, actionLabel: "Review clinical record" })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.key.localeCompare(b.key)) : [];
  const today = day(data?.generatedAt || new Date().toISOString());
  const shown = rows.filter(row => (group === "ALL" || row.group === group) && (due === "ALL" || (due === "OVERDUE" ? day(row.date) < today : day(row.date) === today)) && `${row.patient.fullName} ${row.patient.patientNumber} ${row.detail}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <header><div><p className="eyebrow">Continuity of care</p><h1>Recall and follow-up worklists</h1><p>Review the original record, confirm what happened, then arrange the next step.</p></div><button className="secondary" disabled={loading} onClick={() => void refresh()}>Refresh follow-ups</button></header>
    {error && <div className="alert" role="alert">{error} Refresh to try again.</div>}
    {loading && <section className="card"><p role="status">Loading follow-up work…</p></section>}
    {data && <>
      <nav className="followUpCategories" aria-label="Follow-up categories"><button aria-pressed={group === "ALL"} onClick={() => setGroup("ALL")}><span>All follow-up work</span><strong>{rows.length}</strong></button>{(Object.keys(groups) as Group[]).map(key => <button key={key} aria-pressed={group === key} onClick={() => setGroup(key)}><span>{groups[key]}</span><strong>{data.worklists[key].length}{data.truncated[key] ? "+" : ""}</strong></button>)}</nav>
      <section className="card"><div className="cardHead"><div><h2>{group === "ALL" ? "Follow-up actions" : groups[group]}</h2><p>Clinical reviews through {displayDate(data.horizon)}. Missed appointments cover the last 90 days; referrals appear after seven days without an update.</p></div></div>
        <div className="queueTools"><label>Find follow-up work<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Patient, number, clinic or referral" /></label><label>Review dates<select value={due} onChange={event => setDue(event.target.value)}><option value="ALL">All listed dates</option><option value="OVERDUE">Before today</option><option value="TODAY">Today</option></select></label><span role="status">{shown.length} of {rows.length} listed items</span></div>
        {Object.values(data.truncated).some(Boolean) && <p className="alert">This is a limited worklist: up to 100 items per category and the latest 1,000 signed encounters in the last year. Counts describe the records shown, not all facility work.</p>}
        <div className="queue">{shown.map(row => <article className="row followUpRow" key={row.key}><span className="dot"/><div><strong>{row.patient.fullName}</strong><small>{row.patient.patientNumber} · {row.detail}</small><span className="flowTaskState">{groups[row.group]}</span></div><time><small>{row.group === "referrals" ? "Last update" : row.group === "appointments" ? "Appointment" : "Review due"}</small>{displayDate(row.date)}</time>{row.action && <button className="secondary" onClick={row.action}>{row.actionLabel}</button>}</article>)}</div>
        {!shown.length && <div className="empty"><strong>{rows.length ? "No follow-ups match these filters" : "No follow-up work in this snapshot"}</strong><p>{rows.length ? "Clear the search or choose another category or date." : "New items appear when appointments are missed, referral feedback is pending or a signed plan includes a review date."}</p>{rows.length > 0 && <button className="secondary" onClick={() => { setQuery(""); setGroup("ALL"); setDue("ALL"); }}>Clear filters</button>}</div>}
        <p className="listHint">Snapshot {new Date(data.generatedAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })} EAT. Opening an item does not contact the patient or mark care completed. Clinical plans remain listed until reviewed against subsequent care.</p>
      </section>
    </>}
  </>;
}
