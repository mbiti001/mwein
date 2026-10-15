"use client";
import { useEffect, useState } from "react";
import VisitVitalsPanel from "./VisitVitalsPanel";
import { confirmWorkspaceNavigation } from "./useUnsavedConsultation";
type Visit = { id: string; visitNumber: string; clinicallyClosedAt?: string | null; patient: { fullName: string; patientNumber: string } };
export default function VitalsWorkstation({ visits, initialVisitId, onInitialVisitOpened }: { visits: Visit[]; initialVisitId?: string | null; onInitialVisitOpened: () => void }) {
  const [active, setActive] = useState<Visit | null>(null);
  useEffect(() => { if (initialVisitId) { const visit = visits.find(visit => visit.id === initialVisitId); if (visit && visit.id !== active?.id && confirmWorkspaceNavigation()) { setActive(visit); onInitialVisitOpened(); } } }, [initialVisitId, visits, onInitialVisitOpened, active?.id]);
  const current = visits.find(visit => visit.id === active?.id);
  return <><header className="triagePatientHeader"><div><p className="eyebrow">Triage · measurement entry</p><h1>{active ? `Vitals · ${active.patient.fullName}` : "Record vitals"}</h1><p>{active ? `${active.patient.patientNumber} · ${active.visitNumber}` : "Record vitals for an open visit. Clinical assessment is completed by authorized clinical staff."}</p></div>{active && <button className="secondary" onClick={() => { if (confirmWorkspaceNavigation()) setActive(null); }}>Back to visits</button>}</header>
    {active ? current && !current.clinicallyClosedAt ? <VisitVitalsPanel key={active.id} visitId={active.id} capture /> : <p>This visit is no longer open in the worklist.</p> : <section className="card"><div className="vitalsQueueScroll" role="region" aria-label="Open visits for measurements" tabIndex={0}><table className="vitalsQueue"><thead><tr><th>Patient</th><th>Visit</th><th>Action</th></tr></thead><tbody>{visits.filter(visit => !visit.clinicallyClosedAt).map(visit => <tr key={visit.id}><td><strong>{visit.patient.fullName}</strong><small>{visit.patient.patientNumber}</small></td><td>{visit.visitNumber}</td><td><button className="secondary" aria-label={`Open ${visit.patient.fullName}`} onClick={() => setActive(visit)}>Record measurements</button></td></tr>)}</tbody></table></div>{!visits.some(visit => !visit.clinicallyClosedAt) && <p>No open visits awaiting measurements.</p>}</section>}
  </>;
}
