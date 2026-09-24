"use client";
import { useEffect, useState } from "react";
import VisitVitalsPanel from "./VisitVitalsPanel";
type Visit = { id: string; visitNumber: string; clinicallyClosedAt?: string | null; patient: { fullName: string; patientNumber: string } };
export default function VitalsWorkstation({ visits, initialVisitId, onInitialVisitOpened }: { visits: Visit[]; initialVisitId?: string | null; onInitialVisitOpened: () => void }) {
  const [active, setActive] = useState<Visit | null>(null);
  useEffect(() => { if (initialVisitId) { const visit = visits.find(visit => visit.id === initialVisitId); if (visit) { setActive(visit); onInitialVisitOpened(); } } }, [initialVisitId, visits, onInitialVisitOpened]);
  return <><header><div><p className="eyebrow">Shared visit measurements</p><h1>{active ? `Vitals · ${active.patient.fullName}` : "Record vitals"}</h1><p>{active ? `${active.patient.patientNumber} · ${active.visitNumber}` : "Select an open visit to record measurements for clinical staff to review."}</p></div>{active && <button className="secondary" onClick={() => setActive(null)}>Back to visits</button>}</header>
    {active ? <VisitVitalsPanel key={active.id} visitId={active.id} capture /> : <section className="card queue">{visits.filter(visit => !visit.clinicallyClosedAt).map(visit => <button className="row" key={visit.id} onClick={() => setActive(visit)}>{visit.patient.fullName} · {visit.patient.patientNumber} · {visit.visitNumber}</button>)}{!visits.some(visit => !visit.clinicallyClosedAt) && <p>No open visits awaiting measurements.</p>}</section>}
  </>;
}
