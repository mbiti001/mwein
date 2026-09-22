"use client";

import { FormEvent, useEffect, useState } from "react";

type Report = {
  range: { from: string; to: string };
  generatedAt: string;
  summary: {
    visits: number;
    completedVisits: number;
    cancelledVisits: number;
    emergencyVisits: number;
    billed: number;
    received: number;
    outstanding: number;
    claimExceptions: {
      id: string;
      claimNumber: string;
      payer: string;
      amount: number;
      status: string;
      reason: string;
    }[];
  };
  departments: {
    queues: { servicePoint: string; count: number; completed: number; cancelled: number; averageMinutes: number; p90Minutes: number }[];
    referrals: { created: number; sent: number; attended: number; closedLoop: number; closureRate: number };
    pharmacy: { consumption: { code: string; name: string; quantity: number; revenue: number; cost: number }[]; lowStock: { code: string; name: string }[]; expiring30Days: number; expiring90Days: number };
    cashiers: { cashier: string; confirmed: number; reversed: number; transactions: number; methods: Record<string, number> }[];
  };
};
type MohReport = { month: string; reportType: string; submissionStatus: string; facility: { name: string; code: string }; attendance: Record<string, number>; diagnoses: { code: string; description: string; male: number; female: number; other: number; total: number }[]; services: { visits: number; laboratoryOrders: number; imagingOrders: number; medicinesDispensed: number; referrals: number }; completeness: { signedEncounters: number; unsignedVisits: number; visitsWithCodedDiagnosis: number; visitsWithoutCodedDiagnosis: number } };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
const money = (value: number) => `KES ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ReportingWorkstation({ permissions }: { permissions: string[] }) {
  const canOperations = permissions.includes("reports.operations");
  const canClinical = permissions.includes("reports.clinical");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moh, setMoh] = useState<MohReport | null>(null);
  const currentMonth = today().slice(0, 7);

  async function load(from: string, to: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/operations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Report could not be generated");
      setReport(data);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { if (canOperations) void load(today(), today()); }, [canOperations]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void load(String(form.get("from")), String(form.get("to")));
  }
  async function loadMoh(month: string) { setBusy(true); setError(""); try { const response = await fetch(`/api/reports/moh-monthly?month=${encodeURIComponent(month)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Monthly MOH summary could not be generated"); setMoh(data); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  function downloadMoh() { if (!moh) return; const rows = [["MOH/KHIS monthly source summary", moh.month], ["Facility", `${moh.facility.code} · ${moh.facility.name}`], [], ["Service indicator", "Count"], ...Object.entries(moh.services), [], ["Attendance group", "Count"], ...Object.entries(moh.attendance), [], ["ICD-11 code", "Diagnosis", "Male", "Female", "Other", "Total"], ...moh.diagnoses.map(item => [item.code, item.description, item.male, item.female, item.other, item.total])]; const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `MOH-KHIS-source-${moh.month}.csv`; link.click(); URL.revokeObjectURL(link.href); }
  function downloadOperations() { if (!report) return; const rows: (string | number)[][] = [["Mwein operational report", `${report.range.from} to ${report.range.to}`], [], ["Summary", "Value"], ["Visits", report.summary.visits], ["Completed visits", report.summary.completedVisits], ["Emergency visits", report.summary.emergencyVisits], ["Billed", report.summary.billed], ["Received", report.summary.received], ["Outstanding", report.summary.outstanding], [], ["Service point", "Entries", "Completed", "Average minutes", "P90 minutes"], ...report.departments.queues.map(item => [item.servicePoint, item.count, item.completed, item.averageMinutes, item.p90Minutes]), [], ["Cashier", "Transactions", "Confirmed", "Reversed", "Methods"], ...report.departments.cashiers.map(item => [item.cashier, item.transactions, item.confirmed, item.reversed, Object.entries(item.methods).map(([method, amount]) => `${method}:${amount}`).join(";")]), [], ["Medicine code", "Medicine", "Quantity", "Revenue", "Cost"], ...report.departments.pharmacy.consumption.map(item => [item.code, item.name, item.quantity, item.revenue, item.cost]), [], ["Claim", "Payer", "Amount", "Status", "Reason"], ...report.summary.claimExceptions.map(item => [item.claimNumber, item.payer, item.amount, item.status, item.reason])]; const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `Mwein-operations-${report.range.from}-${report.range.to}.csv`; link.click(); URL.revokeObjectURL(link.href); }

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Operational intelligence</p>
          <h1>Facility reports</h1>
          <p>Review workload, collections and payer exceptions without exporting patient-level data.</p>
        </div>
        <div className="actions noPrint"><button className="secondary" onClick={downloadOperations} disabled={!report}>Export CSV</button><button className="primary" onClick={() => window.print()} disabled={!report}>Print / Save PDF</button></div>
      </header>
      {error && <div className="alert">{error}</div>}
      {canOperations && <form className="card reportFilters noPrint" onSubmit={submit}>
        <label>From<input name="from" type="date" defaultValue={today()} required /></label>
        <label>To<input name="to" type="date" defaultValue={today()} required /></label>
        <button className="primary" disabled={busy}>{busy ? "Generating…" : "Generate report"}</button>
      </form>}
      {report && (
        <>
          <section className="metrics reportMetrics">
            <article><small>Visits</small><strong>{report.summary.visits}</strong><span>{report.summary.completedVisits} completed · {report.summary.cancelledVisits} cancelled</span></article>
            <article><small>Emergency visits</small><strong>{report.summary.emergencyVisits}</strong><span>Within selected arrival dates</span></article>
            <article><small>Gross billed</small><strong>{money(report.summary.billed)}</strong><span>Before reversals and adjustments</span></article>
            <article><small>Confirmed receipts</small><strong>{money(report.summary.received)}</strong><span>{money(report.summary.outstanding)} outstanding</span></article>
          </section>
          <section className="card">
            <div className="cardHead"><div><h2>Claim exceptions</h2><p>Rejected claims and submissions unchanged for more than seven days.</p></div><small>{report.range.from} — {report.range.to}</small></div>
            {report.summary.claimExceptions.length ? (
              <div className="queue compact">
                {report.summary.claimExceptions.map((claim) => (
                  <div className="row urgent" key={claim.id}>
                    <span className="dot" /><div><strong>{claim.claimNumber}</strong><small>{claim.payer} · {claim.reason}</small></div>
                    <b>{money(claim.amount)}</b><time>{claim.status}</time>
                  </div>
                ))}
              </div>
            ) : <div className="empty"><strong>No claim exceptions</strong><p>The selected period has no rejected or stale submitted claims.</p></div>}
          </section>
          <div className="supplyGrid">
            <section className="card"><div className="cardHead"><div><h2>Service-point performance</h2><p>Elapsed time from queue entry to completion. Cancelled entries are excluded from wait-time calculations.</p></div></div><div className="queue compact">{report.departments.queues.map(point => <div className="row" key={point.servicePoint}><span className="dot"/><div><strong>{point.servicePoint.replaceAll("_", " ")}</strong><small>{point.completed}/{point.count} completed · {point.cancelled} cancelled · average {point.averageMinutes} min</small></div><b>P90 {point.p90Minutes} min</b></div>)}{!report.departments.queues.length && <p>No queue activity in this period.</p>}</div></section>
            <section className="card"><div className="cardHead"><div><h2>Referral closure</h2><p>Track whether outbound referrals return actionable feedback.</p></div></div><div className="metrics"><article><small>Sent</small><strong>{report.departments.referrals.sent}</strong></article><article><small>Attended</small><strong>{report.departments.referrals.attended}</strong></article><article><small>Closed loop</small><strong>{report.departments.referrals.closureRate}%</strong><span>{report.departments.referrals.closedLoop} returned or closed</span></article></div></section>
          </div>
          <div className="supplyGrid">
            <section className="card"><div className="cardHead"><div><h2>Medicine consumption</h2><p>Top dispensed items with recorded revenue and cost.</p></div><small>{report.departments.pharmacy.expiring30Days} batch group(s) expiring within 30 days</small></div><div className="queue compact">{report.departments.pharmacy.consumption.map(item => <div className="row" key={item.code}><span className="dot"/><div><strong>{item.name}</strong><small>{item.code} · quantity {item.quantity.toLocaleString()} · cost {money(item.cost)}</small></div><b>{money(item.revenue)}</b></div>)}{!report.departments.pharmacy.consumption.length && <p>No dispensing activity in this period.</p>}</div>{report.departments.pharmacy.lowStock.length > 0 && <div className="notice">Low stock: {report.departments.pharmacy.lowStock.map(item => item.name).join(", ")}</div>}</section>
            <section className="card"><div className="cardHead"><div><h2>Cashier reconciliation</h2><p>Receipts attributed to the staff member who recorded each payment.</p></div></div><div className="queue compact">{report.departments.cashiers.map(cashier => <div className="row" key={cashier.cashier}><span className="dot"/><div><strong>{cashier.cashier}</strong><small>{cashier.transactions} transaction(s) · {Object.entries(cashier.methods).map(([method, amount]) => `${method} ${money(amount)}`).join(" · ") || "No confirmed receipts"}</small></div><div><b>{money(cashier.confirmed)}</b>{cashier.reversed > 0 && <small>Reversed {money(cashier.reversed)}</small>}</div></div>)}{!report.departments.cashiers.length && <p>No payment activity in this period.</p>}</div></section>
          </div>
        </>
      )}
      {canClinical && <section className="card noPrint">
        <div className="cardHead"><div><h2>Monthly MOH/KHIS source summary</h2><p>Aggregate outpatient activity for review before entry or import into KHIS. This is not an automatic Ministry submission.</p></div></div>
        <form className="reportFilters" onSubmit={event => { event.preventDefault(); void loadMoh(String(new FormData(event.currentTarget).get("month"))); }}><label>Reporting month<input name="month" type="month" defaultValue={currentMonth} required/></label><button className="primary" disabled={busy}>{busy ? "Generating…" : "Generate monthly summary"}</button></form>
      </section>}
      {moh && <section className="card mohReport"><div className="cardHead"><div><h2>{moh.reportType}</h2><p>{moh.facility.code} · {moh.facility.name} · {moh.month}</p></div><div className="actions noPrint"><button className="secondary" onClick={() => window.print()}>Print</button><button className="primary" onClick={downloadMoh}>Download CSV</button></div></div><div className="metrics"><article><small>Outpatient visits</small><strong>{moh.services.visits}</strong></article><article><small>Laboratory orders</small><strong>{moh.services.laboratoryOrders}</strong></article><article><small>Medicines dispensed</small><strong>{moh.services.medicinesDispensed}</strong></article><article><small>Referrals sent</small><strong>{moh.services.referrals}</strong></article></div>{(moh.completeness.unsignedVisits > 0 || moh.completeness.visitsWithoutCodedDiagnosis > 0) && <div className="alert"><strong>Resolve before reporting:</strong> {moh.completeness.unsignedVisits} unsigned visit(s); {moh.completeness.visitsWithoutCodedDiagnosis} without a coded diagnosis.</div>}<h3>Attendance by sex and age band</h3><div className="summaryGrid">{Object.entries(moh.attendance).map(([group,count]) => <div className="summaryLine" key={group}><strong>{group.replaceAll("_", " ")}</strong><span>{count}</span></div>)}</div><h3>Diagnosis totals</h3><table className="reportResults"><thead><tr><th>ICD-11</th><th>Diagnosis</th><th>Male</th><th>Female</th><th>Other</th><th>Total</th></tr></thead><tbody>{moh.diagnoses.map(item => <tr key={item.code}><td>{item.code}</td><td>{item.description}</td><td>{item.male}</td><td>{item.female}</td><td>{item.other}</td><td>{item.total}</td></tr>)}</tbody></table></section>}
    </>
  );
}
