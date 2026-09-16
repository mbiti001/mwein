"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Profile = {
  status: string;
  draftVersion: string;
  contractReference: string | null;
  facilityFid: string | null;
  regulatorRegistration: string | null;
  countyOffice: string | null;
  effectiveDate: string | null;
  facilityTier: string | null;
  enabledFunds: string[];
  tariffScheduleVersion: string | null;
  pomsfAccessMatrixVersion: string | null;
  notes: string | null;
  updatedAt: string;
  updatedBy?: { displayName: string };
};

type Readiness = {
  phase: string;
  activationReady: boolean;
  draftVersion: string;
  enabledFunds: string[];
  checks: Record<string, boolean>;
};

type Response = {
  profile: Profile | null;
  readiness: Readiness;
  gateway: { ready: boolean; checks: Record<string, boolean> };
  draftSpecification: {
    notice: string;
    sources: { part: string; name: string; url: string }[];
  };
};

const labels: Record<string, string> = {
  draftSpecificationLoaded: "Published draft specification recorded",
  contractExecuted: "Contract executed",
  contractReference: "Contract reference recorded",
  facilityFid: "SHA facility FID recorded",
  regulatorRegistration: "Regulator registration recorded",
  countyOffice: "SHA county office recorded",
  effectiveDate: "Contract effective date recorded",
  facilityTier: "Facility tier confirmed",
  enabledFunds: "Enabled funds confirmed",
  tariffScheduleVersion: "Signed tariff schedule recorded",
  contractActivated: "Contract configuration activated",
  transportImplemented: "Authenticated FHIR transport implemented",
  baseUrl: "Production FHIR endpoint configured",
  facilityCode: "SHA facility code configured",
  clientId: "OAuth client ID configured",
  clientSecret: "OAuth client secret configured",
};

function dateInput(value?: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export default function ShaContractReadinessPanel({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(() => jsonRequest<Response>("/api/admin/sha-contract", undefined, "SHA contract readiness could not be loaded").then(setData), []);
  useEffect(() => { void load().catch((reason) => setError((reason as Error).message)); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const optional = (name: string) => String(form.get(name) || "").trim() || undefined;
    try {
      await jsonRequest("/api/admin/sha-contract", {
        method: "PATCH",
        body: JSON.stringify({
          status: form.get("status"),
          contractReference: optional("contractReference"),
          facilityFid: optional("facilityFid"),
          regulatorRegistration: optional("regulatorRegistration"),
          countyOffice: optional("countyOffice"),
          effectiveDate: optional("effectiveDate"),
          facilityTier: optional("facilityTier"),
          enabledFunds: form.getAll("enabledFunds"),
          tariffScheduleVersion: optional("tariffScheduleVersion"),
          pomsfAccessMatrixVersion: optional("pomsfAccessMatrixVersion"),
          notes: optional("notes"),
        }),
      }, "SHA contract preparation register could not be saved");
      await load(); setNotice("SHA contract preparation register saved.");
    } catch (reason) { setError((reason as Error).message); }
  }

  if (!data && !error) return <section className="card"><p>Loading SHA contract readiness…</p></section>;
  const profile = data?.profile;
  const contractChecks = data ? Object.entries(data.readiness.checks) : [];
  const gatewayChecks = data ? Object.entries(data.gateway.checks) : [];
  return <>
    {error && <div className="alert">{error}</div>}{notice && <div className="alert success">{notice}</div>}
    {data && <section className="card">
      <div className="cardHead"><div><h2>SHA contract readiness</h2><p>{data.draftSpecification.notice}</p></div><span className={`statusPill ${data.readiness.activationReady ? "done" : "waiting"}`}>{data.readiness.phase.replaceAll("_", " ")}</span></div>
      <div className="summaryGrid">
        <div className="summaryLine"><strong>Draft specification</strong><span>{data.readiness.draftVersion}</span></div>
        <div className="summaryLine"><strong>Register status</strong><span>{profile?.status || "NOT STARTED"}</span></div>
        <div className="summaryLine"><strong>Enabled funds</strong><span>{data.readiness.enabledFunds.join(", ") || "Pending"}</span></div>
        <div className="summaryLine"><strong>Live SHA exchange</strong><span>{data.gateway.ready ? "Ready" : "Blocked"}</span></div>
      </div>
      <div className="supplyGrid compact">
        <div><h3>Contract checklist</h3><div className="queue">{contractChecks.map(([code, ready]) => <div className="row" key={code}><span className="dot" style={{ background: ready ? undefined : "#d99b0b" }}/><div><strong>{labels[code] || code}</strong><small>{ready ? "Ready" : "Pending"}</small></div></div>)}</div></div>
        <div><h3>Integration checklist</h3><div className="queue">{gatewayChecks.map(([code, ready]) => <div className="row" key={code}><span className="dot" style={{ background: ready ? undefined : "#d99b0b" }}/><div><strong>{labels[code] || code}</strong><small>{ready ? "Ready" : "Pending"}</small></div></div>)}</div></div>
      </div>
      <details className="managementPanel compact"><summary><span><strong>Official draft sources</strong><small>Parts A and B1–B4 plus the provider annexures</small></span><b>{data.draftSpecification.sources.length}</b></summary><div className="managementBody queue">{data.draftSpecification.sources.map(source => <a className="row" href={source.url} target="_blank" rel="noreferrer" key={source.part}><span className="dot"/><div><strong>{source.part} · {source.name}</strong><small>Open official SHA publication</small></div></a>)}</div></details>
    </section>}
    {data && <form className="card dataForm" onSubmit={save}>
      <div className="wide"><h2>Contract preparation register</h2><p>Record confirmed information as SHA supplies it. Selecting EXECUTED is blocked until the required signed details are complete.</p></div>
      <label>Status<select name="status" defaultValue={profile?.status || "DRAFT"} disabled={!canEdit}><option value="DRAFT">Draft reference</option><option value="PREPARING">Preparing for signature</option><option value="EXECUTED">Executed</option></select></label>
      <label>Contract reference<input name="contractReference" defaultValue={profile?.contractReference || ""} disabled={!canEdit}/></label>
      <label>Facility FID<input name="facilityFid" defaultValue={profile?.facilityFid || ""} disabled={!canEdit}/></label>
      <label>Regulator registration / COC<input name="regulatorRegistration" defaultValue={profile?.regulatorRegistration || ""} disabled={!canEdit}/></label>
      <label>SHA county office<input name="countyOffice" defaultValue={profile?.countyOffice || ""} disabled={!canEdit}/></label>
      <label>Effective date<input name="effectiveDate" type="date" defaultValue={dateInput(profile?.effectiveDate)} disabled={!canEdit}/></label>
      <label>Facility tier<input name="facilityTier" defaultValue={profile?.facilityTier || ""} disabled={!canEdit}/></label>
      <label>Tariff schedule version<input name="tariffScheduleVersion" defaultValue={profile?.tariffScheduleVersion || ""} disabled={!canEdit}/></label>
      <fieldset className="wide coverageItems"><legend>Funds enabled by the contract</legend>{["PHF", "SHIF", "ECCIF", "POMSF"].map(fund => <label key={fund}><input name="enabledFunds" type="checkbox" value={fund} defaultChecked={profile?.enabledFunds.includes(fund)} disabled={!canEdit}/><span><strong>{fund}</strong></span></label>)}</fieldset>
      <label className="wide">POMSF access-matrix version<input name="pomsfAccessMatrixVersion" defaultValue={profile?.pomsfAccessMatrixVersion || ""} disabled={!canEdit}/></label>
      <label className="wide">Preparation notes<textarea name="notes" defaultValue={profile?.notes || ""} maxLength={3000} disabled={!canEdit}/></label>
      <div className="wide submitBar"><span>{profile?.updatedAt ? `Last updated ${new Date(profile.updatedAt).toLocaleString()} by ${profile.updatedBy?.displayName || "facility administrator"}` : "No facility-specific contract details have been recorded."}</span>{canEdit && <button className="primary">Save SHA register</button>}</div>
    </form>}
  </>;
}
