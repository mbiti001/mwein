"use client";

import { FormEvent, useEffect, useState } from "react";

type Role = { id: string; code: string; name: string };
type Staff = { id: string; displayName: string; email: string; status: string; roles: { role: Role }[] };

async function request<T>(options?: RequestInit): Promise<T> {
  const response = await fetch("/api/admin/users", { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Staff request could not be completed");
  return data;
}

export default function StaffWorkstation() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

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
    <form className="card dataForm" onSubmit={create}>
      <div className="wide"><h2>Add staff member</h2><p>Use an individual account for every person. Passwords must contain at least 16 characters.</p></div>
      <label>Full name *<input name="displayName" minLength={2} required /></label>
      <label>Work email *<input name="email" type="email" autoComplete="off" required /></label>
      <label>Role *<select name="roleCode">{roles.map((role) => <option value={role.code} key={role.id}>{role.name}</option>)}</select></label>
      <label>Temporary password *<input name="temporaryPassword" type="password" minLength={16} autoComplete="new-password" required /></label>
      <button className="primary wide" disabled={busy}>{busy ? "Creating…" : "Create staff account"}</button>
    </form>
    <section className="card compact"><div className="cardHead"><div><h2>Facility staff</h2><p>Role or status changes sign the staff member out immediately.</p></div><strong>{staff.length} accounts</strong></div>
      <div className="staffList">{staff.map((person) => <form className="staffRow" key={person.id} onSubmit={(event) => void update(event, person.id)}>
        <div><strong>{person.displayName}</strong><small>{person.email}</small></div>
        <label>Role<select name="roleCode" defaultValue={person.roles[0]?.role.code}>{roles.map((role) => <option value={role.code} key={role.id}>{role.name}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={person.status === "ACTIVE" ? "ACTIVE" : "DISABLED"}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select></label>
        <label>New temporary password<input name="temporaryPassword" type="password" minLength={16} autoComplete="new-password" placeholder="Leave blank to keep current" /></label>
        <button className="secondary" disabled={busy}>Save access</button>
      </form>)}</div>
    </section>
  </>;
}
