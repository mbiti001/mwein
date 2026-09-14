"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Evidence = {
  gateCode: string;
  status: string;
  owner: string;
  evidenceReference: string | null;
  notes?: string | null;
  approvedAt: string | null;
  reviewDueAt: string | null;
};
type Gate = {
  code: string;
  name: string;
  ownerRole: string;
  description: string;
  ready: boolean;
  expired: boolean;
  evidence: Evidence | null;
};
type Readiness = { ready: boolean; approved: number; total: number; gates: Gate[] };

function localDate(value?: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export default function GovernancePanel({ canEdit }: { canEdit: boolean }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(() => jsonRequest<Readiness>("/api/admin/governance").then(setReadiness), []);
  useEffect(() => { void load().catch((reason) => setError((reason as Error).message)); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>, gate: Gate) {
    event.preventDefault();
    setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const status = String(form.get("status"));
    const approvedAt = String(form.get("approvedAt") || "");
    try {
      await jsonRequest("/api/admin/governance", {
        method: "PATCH",
        body: JSON.stringify({
          gateCode: gate.code,
          status,
          owner: form.get("owner"),
          evidenceReference: form.get("evidenceReference") || undefined,
          notes: form.get("notes") || undefined,
          approvedAt: status === "APPROVED" && approvedAt ? new Date(approvedAt).toISOString() : undefined,
          reviewDueAt: form.get("reviewDueAt") ? new Date(String(form.get("reviewDueAt"))).toISOString() : undefined,
        }),
      });
      await load();
      setNotice(`${gate.name} evidence was saved.`);
    } catch (reason) { setError((reason as Error).message); }
  }

  if (!readiness && !error) return <section className="card"><p>Loading governance gates…</p></section>;
  return <section className="card">
    <div className="cardHead"><div><h2>Production release gates</h2><p>Production remains blocked until every accountable owner records current evidence.</p></div><strong>{readiness?.approved || 0}/{readiness?.total || 0}</strong></div>
    {error && <div className="alert">{error}</div>}{notice && <div className="alert success">{notice}</div>}
    <div className="queue">{readiness?.gates.map((gate) => <details className="managementPanel" key={gate.code}>
      <summary><span><strong>{gate.name}</strong><small>{gate.description}</small></span><b>{gate.ready ? "APPROVED" : gate.expired ? "EXPIRED" : gate.evidence?.status || "PENDING"}</b></summary>
      <form className="managementBody formGrid" onSubmit={(event) => save(event, gate)}>
        <label>Owner<input name="owner" defaultValue={gate.evidence?.owner || gate.ownerRole} required minLength={2} disabled={!canEdit} /></label>
        <label>Status<select name="status" defaultValue={gate.evidence?.status || "PENDING"} disabled={!canEdit}><option>PENDING</option><option>BLOCKED</option><option>APPROVED</option><option>EXPIRED</option></select></label>
        <label className="span2">Evidence reference<input name="evidenceReference" defaultValue={gate.evidence?.evidenceReference || ""} placeholder="Document ID, immutable URL, ticket, or signed report" disabled={!canEdit} /></label>
        <label>Approved on<input name="approvedAt" type="date" defaultValue={localDate(gate.evidence?.approvedAt)} disabled={!canEdit} /></label>
        <label>Review due<input name="reviewDueAt" type="date" defaultValue={localDate(gate.evidence?.reviewDueAt)} disabled={!canEdit} /></label>
        <label className="span2">Notes<textarea name="notes" defaultValue={gate.evidence?.notes || ""} maxLength={2000} disabled={!canEdit} /></label>
        {canEdit && <button className="secondary">Save evidence</button>}
      </form>
    </details>)}</div>
  </section>;
}
