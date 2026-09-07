"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Role = { id: string; code: string; name: string; assignable: boolean; permissions: { permission: { code: string; description: string } }[] };
type Staff = { id: string; displayName: string; email: string; status: string; manageable: boolean; roles: { role: Role }[] };

async function request<T>(options?: RequestInit): Promise<T> {
  return jsonRequest<T>("/api/admin/users", options, "Staff request could not be completed");
}

export default function StaffWorkstation() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const assignableRoles = roles.filter(role => role.assignable);
  const visibleStaff = useMemo(() => {
    const term = query.trim().toLowerCase();
    return staff.filter(person => !term || `${person.displayName} ${person.email} ${person.status} ${person.roles[0]?.role.name || ""}`.toLowerCase().includes(term)).slice(0, 50);
  }, [staff, query]);

  async function load() {
    const data = await request<{ users: Staff[]; roles: Role[] }>();
    setStaff(data.users); setRoles(data.roles);
  }
  useEffect(() => { void load().catch((reason) => setError(reason.message)); }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await request({ method: "POST", body: JSON.stringify({ displayName: form.get("displayName"), email: form.get("email"), roleCode: form.get("roleCode"), temporaryPassword: form.get("temporaryPassword") }) });
      setNotice("Staff account created. Share the temporary password securely.");
      event.currentTarget.reset(); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function update(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await request({ method: "PATCH", body: JSON.stringify({ id, roleCode: form.get("roleCode"), status: form.get("status"), temporaryPassword: form.get("temporaryPassword") || undefined }) });
      setNotice("Staff access updated; existing sessions were revoked.");
      await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <header><div><p className="eyebrow">Administration</p><h1>Staff access</h1><p>Create facility accounts and assign one clear operational role.</p></div></header>
    {error && <div className="alert">{error}</div>}{notice && <div className="alert success">{notice}</div>}
    <details className="card managementPanel"><summary><span><strong>Add staff member</strong><small>Create a new individual facility account</small></span><b>Open</b></summary><form className="dataForm managementBody" onSubmit={create}>
      <div className="wide"><h2>Add staff member</h2><p>Use an individual account for every person. Passwords must contain at least 16 characters.</p></div>
      <label>Full name *<input name="displayName" minLength={2} required /></label>
      <label>Work email *<input name="email" type="email" autoComplete="off" required /></label>
      <label>Role *<select name="roleCode">{assignableRoles.map((role) => <option value={role.code} key={role.id}>{role.name}</option>)}</select></label>
      <label>Temporary password *<input name="temporaryPassword" type="password" minLength={16} autoComplete="new-password" required /></label>
      <button className="primary wide" disabled={busy}>{busy ? "Creating…" : "Create staff account"}</button>
    </form></details>
    <section className="card compact"><div className="cardHead"><div><h2>Facility staff</h2><p>Role or status changes sign the staff member out immediately.</p></div><strong>{staff.length} accounts</strong></div>
      <label className="listSearch">Search staff<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, email, role or status" /></label>
      <p className="listCount">Showing {visibleStaff.length} of {staff.length} accounts</p>
      <div className="staffList">{visibleStaff.map((person) => <details className="staffDisclosure" key={person.id}><summary><span><strong>{person.displayName}</strong><small>{person.email} · {person.roles[0]?.role.name || "No role"} · {person.status}</small></span><b>{person.manageable ? "Manage" : "Protected"}</b></summary>{person.manageable ? <form className="staffRow" onSubmit={(event) => void update(event, person.id)}>
        <div><strong>{person.displayName}</strong><small>{person.email}</small></div>
        <label>Role<select name="roleCode" defaultValue={person.roles[0]?.role.code}>{assignableRoles.map((role) => <option value={role.code} key={role.id}>{role.name}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={person.status === "ACTIVE" ? "ACTIVE" : "DISABLED"}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select></label>
        <label>New temporary password<input name="temporaryPassword" type="password" minLength={16} autoComplete="new-password" placeholder="Leave blank to keep current" /></label>
        <button className="secondary" disabled={busy}>Save access</button>
      </form> : <div className="managementBody"><p>This governance account can only be changed by an authorized facility or system administrator.</p></div>}</details>)}</div>
    </section>
    <details className="card managementPanel"><summary><span><strong>Role autonomy guide</strong><small>See exactly what each role can do before assigning it</small></span><b>{assignableRoles.length} roles</b></summary><div className="roleGuide managementBody">{assignableRoles.map(role => <article key={role.id}><strong>{role.name}</strong><small>{role.permissions.map(item => item.permission.description).join(" · ") || "No operational permissions"}</small></article>)}</div></details>
  </>;
}
