"use client";

import { FormEvent, useEffect, useState } from "react";

type Report = {
  range: { from: string; to: string };
  generatedAt: string;
  summary: {
    visits: number;
    completedVisits: number;
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
};
type MohReport = { month: string; reportType: string; submissionStatus: string; facility: { name: string; code: string }; attendance: Record<string, number>; diagnoses: { code: string; description: string; male: number; female: number; other: number; total: number }[]; services: { visits: number; laboratoryOrders: number; imagingOrders: number; medicinesDispensed: number; referrals: number }; completeness: { signedEncounters: number; unsignedVisits: number; visitsWithCodedDiagnosis: number; visitsWithoutCodedDiagnosis: number } };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
const money = (value: number) => `KES ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ReportingWorkstation() {
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

  useEffect(() => { void load(today(), today()); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void load(String(form.get("from")), String(form.get("to")));
  }
  async function loadMoh(month: string) { setBusy(true); setError(""); try { const response = await fetch(`/api/reports/moh-monthly?month=${encodeURIComponent(month)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Monthly MOH summary could not be generated"); setMoh(data); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  function downloadMoh() { if (!moh) return; const rows = [["MOH/KHIS monthly source summary", moh.month], ["Facility", `${moh.facility.code} · ${moh.facility.name}`], [], ["Service indicator", "Count"], ...Object.entries(moh.services), [], ["Attendance group", "Count"], ...Object.entries(moh.attendance), [], ["ICD-11 code", "Diagnosis", "Male", "Female", "Other", "Total"], ...moh.diagnoses.map(item => [item.code, item.description, item.male, item.female, item.other, item.total])]; const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `MOH-KHIS-source-${moh.month}.csv`; link.click(); URL.revokeObjectURL(link.href); }

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Operational intelligence</p>
          <h1>Facility reports</h1>
          <p>Review workload, collections and payer exceptions without exporting patient-level data.</p>
        </div>
        <button className="secondary noPrint" onClick={() => window.print()} disabled={!report}>Print report</button>
      </header>
      {error && <div className="alert">{error}</div>}
      <form className="card reportFilters noPrint" onSubmit={submit}>
        <label>From<input name="from" type="date" defaultValue={today()} required /></label>
        <label>To<input name="to" type="date" defaultValue={today()} required /></label>
        <button className="primary" disabled={busy}>{busy ? "Generating…" : "Generate report"}</button>
      </form>
      {report && (
        <>
          <section className="metrics reportMetrics">
            <article><small>Visits</small><strong>{report.summary.visits}</strong><span>{report.summary.completedVisits} completed</span></article>
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
        </>
      )}
      <section className="card noPrint">
        <div className="cardHead"><div><h2>Monthly MOH/KHIS source summary</h2><p>Aggregate outpatient activity for review before entry or import into KHIS. This is not an automatic Ministry submission.</p></div></div>
        <form className="reportFilters" onSubmit={event => { event.preventDefault(); void loadMoh(String(new FormData(event.currentTarget).get("month"))); }}><label>Reporting month<input name="month" type="month" defaultValue={currentMonth} required/></label><button className="primary" disabled={busy}>{busy ? "Generating…" : "Generate monthly summary"}</button></form>
      </section>
      {moh && <section className="card mohReport"><div className="cardHead"><div><h2>{moh.reportType}</h2><p>{moh.facility.code} · {moh.facility.name} · {moh.month}</p></div><div className="actions noPrint"><button className="secondary" onClick={() => window.print()}>Print</button><button className="primary" onClick={downloadMoh}>Download CSV</button></div></div><div className="metrics"><article><small>Outpatient visits</small><strong>{moh.services.visits}</strong></article><article><small>Laboratory orders</small><strong>{moh.services.laboratoryOrders}</strong></article><article><small>Medicines dispensed</small><strong>{moh.services.medicinesDispensed}</strong></article><article><small>Referrals sent</small><strong>{moh.services.referrals}</strong></article></div>{(moh.completeness.unsignedVisits > 0 || moh.completeness.visitsWithoutCodedDiagnosis > 0) && <div className="alert"><strong>Resolve before reporting:</strong> {moh.completeness.unsignedVisits} unsigned visit(s); {moh.completeness.visitsWithoutCodedDiagnosis} without a coded diagnosis.</div>}<h3>Attendance by sex and age band</h3><div className="summaryGrid">{Object.entries(moh.attendance).map(([group,count]) => <div className="summaryLine" key={group}><strong>{group.replaceAll("_", " ")}</strong><span>{count}</span></div>)}</div><h3>Diagnosis totals</h3><table className="reportResults"><thead><tr><th>ICD-11</th><th>Diagnosis</th><th>Male</th><th>Female</th><th>Other</th><th>Total</th></tr></thead><tbody>{moh.diagnoses.map(item => <tr key={item.code}><td>{item.code}</td><td>{item.description}</td><td>{item.male}</td><td>{item.female}</td><td>{item.other}</td><td>{item.total}</td></tr>)}</tbody></table></section>}
    </>
  );
}
