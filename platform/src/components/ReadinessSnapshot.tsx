"use client";

import { useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Readiness = { ready: boolean; approved: number; total: number; gates: { code: string; ready: boolean; expired: boolean }[] };

export default function ReadinessSnapshot({ onOpen }: { onOpen: () => void }) {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    void jsonRequest<Readiness>("/api/admin/governance").then(value => { if (active) setData(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);
  const groups = [
    { name: "Privacy & security", codes: ["DPIA_DPA", "PENETRATION_TEST", "MFA_ENFORCEMENT", "AUDIT_RETENTION"] },
    { name: "Clinical assurance", codes: ["CLINICAL_UAT", "ICD_TERMINOLOGY"] },
    { name: "National exchange", codes: ["DHA_INTEGRATIONS", "PUBLIC_HEALTH_REPORTING"] },
    { name: "Service continuity", codes: ["BACKUP_RESTORE_DRILL", "INCIDENT_RESPONSE", "RELEASE_TRACEABILITY"] },
  ];
  return <section className="readinessStrip" aria-label="Certification evidence overview">
    <header><div><p className="eyebrow">Quality & assurance</p><h2>Readiness, backed by evidence</h2></div><button className="secondary" onClick={onOpen}>Open administration</button></header>
    <p>Internal evidence indicators supporting DHA preparation. Not a DHA score or certification.</p>
    {error ? <p role="alert">Evidence could not be loaded. <button className="secondary" onClick={() => setAttempt(n => n + 1)}>Retry</button></p> : !data ? <p role="status">Loading facility evidence…</p> : <>
      <span className={`readinessStatus ${data.ready ? "ready" : ""}`}>{data.approved}/{data.total} gates current · {data.ready ? "Internal gates met" : "Review required"}</span>
      <div className="readinessGrid">{groups.map(group => {
        const gates = data.gates.filter(gate => group.codes.includes(gate.code));
        const approved = gates.filter(gate => gate.ready).length;
        return <article key={group.name}><small>{group.name}</small><strong>{approved}/{group.codes.length}</strong><small>{gates.some(gate => gate.expired) ? "Expired evidence needs review" : approved === group.codes.length ? "Recorded gates current" : "Evidence outstanding"}</small></article>;
      })}</div>
    </>}
  </section>;
}
