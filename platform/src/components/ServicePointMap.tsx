"use client";

import {
  currentServicePoint,
  servicePointCounts,
  servicePoints,
  waitingMinutes,
  type FlowVisit,
} from "@/lib/service-points";

export default function ServicePointMap({
  visits,
  onOpen,
}: {
  visits: FlowVisit[];
  onOpen: (screen: string) => void;
}) {
  const counts = servicePointCounts(visits);
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Patient flow</p>
          <h1>Service point map</h1>
          <p>See each active queue, its next handoff and the patients waiting there.</p>
        </div>
      </header>
      <section className="serviceMap" aria-label="Service point overview">
        {servicePoints.map((point, index) => (
          <article className="card servicePoint" key={point.code}>
            <div className="servicePointHead"><span>{index + 1}</span><div><h2>{point.label}</h2><small>Next: {point.next}</small></div><strong>{counts[point.code]}</strong></div>
            <button className="secondary" onClick={() => onOpen(point.screen)}>Open {point.label}</button>
          </article>
        ))}
      </section>
      <section className="card compact">
        <div className="cardHead"><div><h2>Current patient locations</h2><p>Sorted by clinical priority and arrival time.</p></div><strong>{visits.length} active</strong></div>
        {visits.length ? <div className="queue">{visits.map((visit) => {
          const point = currentServicePoint(visit);
          const label = servicePoints.find((item) => item.code === point)?.label || "Review needed";
          const wait = waitingMinutes(visit);
          return <div className={`row ${visit.priority.toLowerCase()}`} key={visit.id}><span className="dot"/><div><strong>{visit.patient.fullName}</strong><small>{visit.patient.patientNumber} · {label}</small></div><b>{visit.priority}</b><time>{wait < 60 ? `${wait} min` : `${Math.floor(wait / 60)}h ${wait % 60}m`}</time></div>;
        })}</div> : <div className="empty"><strong>No active visits</strong><p>Checked-in patients will appear here automatically.</p></div>}
      </section>
    </>
  );
}
