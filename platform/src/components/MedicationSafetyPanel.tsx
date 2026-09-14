"use client";

import { FormEvent, useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Rule = { id: string; code: string; kind: "ALLERGY" | "INTERACTION" | "DOSE_LIMIT"; severity: "WARNING" | "HARD_STOP"; status: string; primaryConceptId: string; interactingConceptId: string | null; sourceReference: string; version: string; rule: { message?: string; maxDailyQuantity?: number }; approvedAt: string | null; approvedBy: { displayName: string } | null };

export default function MedicationSafetyPanel() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [kind, setKind] = useState<Rule["kind"]>("ALLERGY");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function load() { try { const data = await jsonRequest<{ rules: Rule[] }>("/api/admin/medication-safety", undefined, "Medication safety rules could not be loaded"); setRules(data.rules); } catch (reason) { setError((reason as Error).message); } }
  useEffect(() => { void load(); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const rule = kind === "DOSE_LIMIT"
      ? { kind, message: form.get("message"), maxDailyQuantity: Number(form.get("maxDailyQuantity")) }
      : { kind, message: form.get("message") };
    try {
      await jsonRequest("/api/admin/medication-safety", { method: "POST", body: JSON.stringify({ action: "CREATE_DRAFT", code: form.get("code"), version: form.get("version"), severity: form.get("severity"), primaryConceptId: form.get("primaryConceptId"), interactingConceptId: kind === "INTERACTION" ? form.get("interactingConceptId") : undefined, sourceReference: form.get("sourceReference"), rule }) }, "Medication safety draft could not be created");
      event.currentTarget.reset(); setKind("ALLERGY"); setNotice("Draft saved. A different medical director must review it before activation."); await load();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function transition(id: string, action: "APPROVE" | "RETIRE") {
    const reason = window.prompt(action === "APPROVE" ? "Record the independent clinical review and evidence checked:" : "Why is this rule being retired?");
    if (!reason) return;
    setBusy(true); setError(""); setNotice("");
    try { await jsonRequest("/api/admin/medication-safety", { method: "POST", body: JSON.stringify({ action, id, reason }) }, "Medication safety rule could not be updated"); setNotice(action === "APPROVE" ? "Rule approved and activated." : "Rule retired."); await load(); }
    catch (reasonValue) { setError((reasonValue as Error).message); } finally { setBusy(false); }
  }
  return <div className="embeddedWorkspace">
    <section className="card"><div className="cardHead"><div><h2>Medication safety governance</h2><p>Rules are facility-specific, evidence-linked, versioned and independently approved. No unverified clinical content is preloaded.</p></div></div>
      {error && <div className="alert">{error}</div>}{notice && <div className="notice">{notice}</div>}
      <form className="clinicalForm" onSubmit={create}>
        <div className="formGrid"><label>Rule code<input name="code" placeholder="AMOX-ALLERGY" required /></label><label>Version<input name="version" placeholder="1.0" required /></label><label>Kind<select name="kind" value={kind} onChange={event => setKind(event.target.value as Rule["kind"])}><option value="ALLERGY">Allergy match</option><option value="INTERACTION">Drug interaction</option><option value="DOSE_LIMIT">Daily dose limit</option></select></label><label>Severity<select name="severity" defaultValue="WARNING"><option value="WARNING">Warning</option><option value="HARD_STOP">Hard stop</option></select></label><label>Primary medication concept<input name="primaryConceptId" placeholder="amoxicillin" required /></label>{kind === "INTERACTION" && <label>Interacting medication concept<input name="interactingConceptId" placeholder="warfarin" required /></label>}{kind === "DOSE_LIMIT" && <label>Maximum daily quantity<input name="maxDailyQuantity" type="number" min="0.001" step="0.001" required /></label>}<label className="wide">Evidence/source reference<input name="sourceReference" placeholder="Approved formulary, protocol, or reviewed source URL/version" required /></label><label className="wide">Clinician-facing message<textarea name="message" minLength={10} maxLength={500} required /></label></div>
        <button className="primary" disabled={busy}>Save governed draft</button>
      </form>
    </section>
    <section className="card"><div className="cardHead"><div><h2>Rule register</h2><p>Only approved rules participate in prescribing checks.</p></div><strong>{rules.length}</strong></div><div className="queue">{rules.map(rule => <div className="row" key={rule.id}><span className="dot"/><div><strong>{rule.code} · {rule.kind.replaceAll("_", " ")}</strong><small>{rule.severity} · v{rule.version} · {rule.primaryConceptId}{rule.interactingConceptId ? ` + ${rule.interactingConceptId}` : ""}</small><small>{rule.rule.message} · Source: {rule.sourceReference}</small>{rule.approvedBy && <small>Approved by {rule.approvedBy.displayName}</small>}</div><span className={`statusPill ${rule.status === "APPROVED" ? "done" : "waiting"}`}>{rule.status}</span>{rule.status === "DRAFT" && <button className="secondary" disabled={busy} onClick={() => void transition(rule.id, "APPROVE")}>Approve</button>}{rule.status === "APPROVED" && <button className="secondary" disabled={busy} onClick={() => void transition(rule.id, "RETIRE")}>Retire</button>}</div>)}{!rules.length && <div className="empty"><strong>No safety rules entered</strong><p>Create rules only from facility-approved clinical evidence.</p></div>}</div></section>
  </div>;
}
