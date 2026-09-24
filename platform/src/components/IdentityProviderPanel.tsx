"use client";

import { FormEvent, useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type IdentityData = {
  configuration: {
    configured: boolean;
    issuer: string | null;
    redirectUri: string | null;
    checks: { code: string; ready: boolean }[];
  };
  mappings: { id: string; providerGroup: string; roleCode: string; active: boolean }[];
  roles: { code: string; name: string }[];
  linkedIdentities: number;
};

export default function IdentityProviderPanel() {
  const [data, setData] = useState<IdentityData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      setData(await jsonRequest<IdentityData>("/api/admin/identity", undefined, "Identity configuration could not be loaded"));
    } catch (reason) { setError((reason as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await jsonRequest("/api/admin/identity", {
        method: "POST",
        body: JSON.stringify({ providerGroup: form.get("providerGroup"), roleCode: form.get("roleCode"), active: true }),
      }, "Identity role mapping could not be saved");
      event.currentTarget.reset();
      await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function toggle(mapping: IdentityData["mappings"][number]) {
    setBusy(true); setError("");
    try {
      await jsonRequest("/api/admin/identity", {
        method: "POST",
        body: JSON.stringify({ providerGroup: mapping.providerGroup, roleCode: mapping.roleCode, active: !mapping.active }),
      }, "Identity role mapping could not be updated");
      await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  if (!data && !error) return <section className="card"><p>Loading workforce identity controls…</p></section>;
  return <div className="embeddedWorkspace">
    {error && <div className="alert">{error}</div>}
    {data && <>
      <section className="card">
        <div className="cardHead"><div><h2>Workforce identity boundary</h2><p>Prepare an optional standards-based OIDC connection. Local staff accounts retain their MFA requirements.</p></div><span className={`statusPill ${data.configuration.configured ? "done" : "waiting"}`}>{data.configuration.configured ? "Configured" : "Not configured"}</span></div>
        <div className="summaryGrid">
          {data.configuration.checks.map(check => <div className="summaryLine" key={check.code}><strong>{check.code.replaceAll("_", " ")}</strong><span>{check.ready ? "Ready" : "Pending"}</span></div>)}
          <div className="summaryLine"><strong>Linked workforce identities</strong><span>{data.linkedIdentities}</span></div>
        </div>
        {!data.configuration.configured && <div className="notice">Set the four OIDC deployment variables before enabling provider login. Group mappings below cannot activate or elevate any account on their own.</div>}
      </section>
      <section className="card">
        <div className="cardHead"><div><h2>Provider group mappings</h2><p>Map exact provider groups to operational roles. System administrator access is intentionally excluded.</p></div></div>
        <form className="reportFilters" onSubmit={save}>
          <label>Provider group<input name="providerGroup" placeholder="clinic nurses" minLength={2} required /></label>
          <label>Operational role<select name="roleCode" required defaultValue=""><option value="" disabled>Select role</option>{data.roles.map(role => <option value={role.code} key={role.code}>{role.name}</option>)}</select></label>
          <button className="primary" disabled={busy}>Add mapping</button>
        </form>
        <div className="queue compact">{data.mappings.map(mapping => <div className="row" key={mapping.id}><span className="dot"/><div><strong>{mapping.providerGroup}</strong><small>{data.roles.find(role => role.code === mapping.roleCode)?.name || mapping.roleCode} · {mapping.active ? "active" : "inactive"}</small></div><button className="secondary" disabled={busy} onClick={() => void toggle(mapping)}>{mapping.active ? "Disable" : "Enable"}</button></div>)}{!data.mappings.length && <div className="empty"><strong>No mappings yet</strong><p>Add mappings after agreeing the provider group names with your identity administrator.</p></div>}</div>
      </section>
    </>}
  </div>;
}
