"use client";
import { Button } from "./ui/Button";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import StaffMfaRecovery from "./StaffMfaRecovery";
import { jsonRequest } from "@/lib/client-http";

type Role = { id: string; code: string; name: string; assignable: boolean; permissions: { permission: { code: string; description: string } }[] };
type Staff = { self?: boolean; canRecoverMfa?: boolean; mfaCredential?: { enabledAt: string | null } | null; id: string; displayName: string; email: string; status: string; manageable: boolean; roles: { role: Role }[] };

function roleNames(person: Staff) {
  return person.roles.map(({ role }) => role.name).sort().join(", ");
}

function RoleSelection({ roles, person }: { roles: Role[]; person?: Staff }) {
  const assigned = person?.roles.map(item => item.role.code) ?? [];
  return <fieldset className="staffRoles wide">
    <legend>Assigned roles *</legend>
    <p>{person?.self ? "Another administrator must grant new roles to your account." : "Select one or more roles. The staff member can use the departments each role allows."}</p>
    <div className="staffRoleOptions">{roles.map(role => <label key={role.code}>
      <input type="checkbox" name="roleCodes" value={role.code} defaultChecked={assigned.includes(role.code)}
        disabled={person?.self && !assigned.includes(role.code)} />{role.name}
    </label>)}</div>
  </fieldset>;
}

function readRoles(form: HTMLFormElement) {
  const codes = new FormData(form).getAll("roleCodes").map(String);
  if (codes.length) return codes;
  const first = form.querySelector<HTMLInputElement>('input[name="roleCodes"]:not(:disabled)');
  if (first) {
    first.setCustomValidity("Select at least one role.");
    first.reportValidity();
    first.setCustomValidity("");
  }
  return null;
}

async function request<T>(options?: RequestInit): Promise<T> {
  return jsonRequest<T>("/api/admin/users", options, "Staff request could not be completed");
}

export default function StaffWorkstation() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const assignableRoles = roles.filter(role => role.assignable);
  const visibleStaff = useMemo(() => {
    const term = query.trim().toLowerCase();
    return staff.filter(person => !term || `${person.displayName} ${person.email} ${person.status} ${roleNames(person)}`.toLowerCase().includes(term)).slice(0, 50);
  }, [staff, query]);

  async function load() {
    const data = await request<{ users: Staff[]; roles: Role[] }>();
    setStaff(data.users); setRoles(data.roles);
  }
  useEffect(() => { void load().catch((reason) => setError(reason.message)); }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const roleCodes = readRoles(formElement);
    if (!roleCodes || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    const form = new FormData(formElement);
    try {
      await request({ method: "POST", body: JSON.stringify({ displayName: form.get("displayName"), email: form.get("email"), roleCodes, temporaryPassword: form.get("temporaryPassword") }) });
      setNotice("Staff account created. Share the temporary password securely.");
      formElement.reset(); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }

  async function update(event: FormEvent<HTMLFormElement>, person: Staff) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const roleCodes = readRoles(formElement);
    if (!roleCodes || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    const form = new FormData(formElement);
    try {
      await request({ method: "PATCH", body: JSON.stringify({ id: person.id, roleCodes, previousRoleCodes: person.roles.map(item => item.role.code), status: form.get("status") !== person.status ? form.get("status") : undefined, temporaryPassword: form.get("temporaryPassword") || undefined }) });
      setNotice("Staff access updated; existing sessions were revoked.");
      formElement.reset(); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }

  return <>
    <header><div><p className="eyebrow">Administration</p><h1>Staff access</h1><p>Assign one or more roles to each staff member’s individual account.</p></div></header>
    <section className="card compact"><h2>Clinician shortage cover</h2><p>Assign “Clinician — shortage cover” to an authorised clinician when reception, nursing or billing staff are unavailable. It includes normal clinical access, patient registration, visit check-in, vitals and payment collection. When cover ends, remove the cover role and keep the staff member’s regular assignments. Payment reversals and cashier approval remain with finance staff.</p></section>
    {error && <div className="alert" role="alert">{error} <Button variant="secondary" onClick={() => void load().then(() => setError("")).catch(reason => setError(reason.message))}>Refresh staff</Button></div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <details className="card managementPanel"><summary><span><strong>Add staff member</strong><small>Create a new individual facility account</small></span><b>Open</b></summary><form className="dataForm managementBody" onSubmit={create}>
      <div className="wide"><h2>Add staff member</h2><p>Use an individual account for every person. Passwords must contain at least 16 characters.</p></div>
      <label>Full name *<input name="displayName" minLength={2} required /></label>
      <label>Work email *<input name="email" type="email" autoComplete="off" required /></label>
      <label>Temporary password *<input name="temporaryPassword" type="password" minLength={16} autoComplete="new-password" required /></label>
      <RoleSelection roles={assignableRoles} />
      <Button type="submit" className="wide" pending={busy} pendingLabel="Creating…">Create staff account</Button>
    </form></details>
    <section className="card compact"><div className="cardHead"><div><h2>Facility staff</h2><p>Role or status changes sign the staff member out immediately.</p></div><strong>{staff.length} accounts</strong></div>
      <label className="listSearch">Search staff<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, email, role or status" /></label>
      <p className="listCount">Showing {visibleStaff.length} of {staff.length} accounts</p>
      <div className="staffList">{visibleStaff.map((person) => <details className="staffDisclosure" key={person.id}><summary><span><strong>{person.displayName}</strong><small>{person.email} · {roleNames(person) || "No roles"} · {person.status} · MFA {person.mfaCredential?.enabledAt ? "enrolled" : "setup pending"}</small></span><b>{person.manageable ? "Manage" : "Protected"}</b></summary>{person.manageable ? <form className="staffRow" key={person.status + person.roles.map(item => item.role.code).sort().join(",")} onSubmit={(event) => void update(event, person)}>
        <RoleSelection roles={assignableRoles} person={person} />
        <label>Status<select name="status" defaultValue={person.status}>{person.status === "LOCKED" && <option value="LOCKED">Locked</option>}<option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select></label>
        <label>New temporary password<input name="temporaryPassword" type="password" minLength={16} autoComplete="new-password" placeholder="Leave blank to keep current" /></label>
        <Button type="submit" variant="secondary" pending={busy} pendingLabel="Saving…">Save access</Button>
      </form> : <div className="managementBody"><p>This governance account can only be changed by an authorized facility or system administrator.</p></div>}{person.canRecoverMfa && <StaffMfaRecovery userId={person.id} onRecovered={async () => { setNotice("Lost factors and sessions revoked. Share the temporary password securely; new enrollment is required."); await load(); }} />}</details>)}</div>
    </section>
    <details className="card managementPanel"><summary><span><strong>Role autonomy guide</strong><small>See exactly what each role can do before assigning it</small></span><b>{assignableRoles.length} roles</b></summary><div className="roleGuide managementBody">{assignableRoles.map(role => <article key={role.id}><strong>{role.name}</strong><small>{role.permissions.map(item => item.permission.description).join(" · ") || "No operational permissions"}</small></article>)}</div></details>
  </>;
}
