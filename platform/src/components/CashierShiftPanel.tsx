"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Shift = { id: string; status: string; isMine: boolean; openingFloat: string; expectedCash: string | null; countedCash: string | null; variance: string | null; varianceReason: string | null; openedAt: string; cashier: { displayName: string }; approvedBy: { displayName: string } | null; totals: { receipts: number; expectedCash: number } };
const money = (value: unknown) => `KES ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CashierShiftPanel({ permissions }: { permissions: string[] }) {
  const [shifts, setShifts] = useState<Shift[]>([]); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const canApprove = permissions.includes("billing.approve_shift");
  const load = useCallback(async () => setShifts((await jsonRequest<{ shifts: Shift[] }>("/api/billing/shifts", undefined, "Cashier shifts could not be loaded")).shifts), []);
  useEffect(() => { void load().catch(reason => setError(reason.message)); }, [load]);
  async function act(body: Record<string, unknown>, success: string) { setBusy(true); setError(""); setNotice(""); try { await jsonRequest("/api/billing/shifts", { method: "POST", body: JSON.stringify(body) }, "Cashier shift could not be updated"); setNotice(success); await load(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  function open(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void act({ action: "OPEN", openingFloat: form.get("openingFloat") }, "Cashier shift opened. Cash receipts will now be attributed to it."); }
  function submit(event: FormEvent<HTMLFormElement>, id: string) { event.preventDefault(); const form = new FormData(event.currentTarget); void act({ action: "SUBMIT", id, countedCash: form.get("countedCash"), varianceReason: form.get("varianceReason") || undefined }, "Shift submitted for independent approval."); }
  const ownOpen = shifts.find(shift => shift.status === "OPEN" && shift.isMine);
  return <details className="card managementPanel" open={Boolean(ownOpen)}><summary><span><strong>Cashier shift</strong><small>Opening float, cash receipts, counted cash and independent closure</small></span><b>{ownOpen ? "OPEN" : shifts.filter(item => item.status === "SUBMITTED").length ? `${shifts.filter(item => item.status === "SUBMITTED").length} TO APPROVE` : "CONTROLLED"}</b></summary><div className="managementBody">
    {error && <div className="alert">{error}</div>}{notice && <div className="alert success">{notice}</div>}
    {!ownOpen && !shifts.some(shift => shift.status === "SUBMITTED" && shift.isMine) && <form className="inlineForm" onSubmit={open}><label>Opening cash float<input name="openingFloat" type="number" min="0" step="0.01" required /></label><button className="primary" disabled={busy}>Open shift</button></form>}
    <div className="queue compact">{shifts.slice(0, 12).map(shift => <div className="row" key={shift.id}><span className="dot"/><div><strong>{shift.cashier.displayName} · {shift.status}</strong><small>Opened {new Date(shift.openedAt).toLocaleString()} · float {money(shift.openingFloat)} · cash receipts {money(shift.totals.receipts)}</small>{shift.status !== "OPEN" && <small>Expected {money(shift.expectedCash)} · counted {money(shift.countedCash)} · variance {money(shift.variance)}</small>}{shift.varianceReason && <small>Variance reason: {shift.varianceReason}</small>}{shift.approvedBy && <small>Approved by {shift.approvedBy.displayName}</small>}{shift.status === "OPEN" && shift.isMine && <form className="queueTransfer" onSubmit={event => submit(event, shift.id)}><input name="countedCash" type="number" min="0" step="0.01" placeholder="Counted cash" required/><input name="varianceReason" minLength={5} maxLength={500} placeholder="Variance reason, if any"/><button className="primary" disabled={busy}>Submit closure</button></form>}</div>{shift.status === "SUBMITTED" && canApprove && !shift.isMine && <button className="primary" disabled={busy} onClick={() => { const reason = window.prompt("Approval note (optional):") || undefined; void act({ action: "APPROVE", id: shift.id, reason }, "Cashier shift approved and closed."); }}>Approve</button>}</div>)}{!shifts.length && canApprove && <p>No cashier shifts recorded.</p>}</div>
  </div></details>;
}
