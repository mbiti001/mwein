"use client";

type Observation = { code: string; valueDecimal?: string | null; unit?: string | null; recordedAt?: string };
export type TrendVisit = {
  id: string; arrivedAt: string; status?: string;
  triage?: { observations: Observation[] } | null;
  orders?: { displayName: string; laboratory?: { testCode?: string; result?: { status: string; items: { analyte: string; value: string; unit?: string | null }[] } | null } | null }[];
};
const labels: Record<string, string> = { BP_SYS: "Systolic BP", BP_DIA: "Diastolic BP", PULSE: "Pulse", TEMP: "Temperature", SPO2: "Oxygen saturation", WEIGHT: "Weight", HEIGHT: "Height", RESP: "Respiratory rate" };

export function patientTrendRows(visits: TrendVisit[]) {
  const groups = new Map<string, { label: string; unit: string; points: { value: number; date: string }[] }>();
  function add(key: string, label: string, unit: string, value: string | null | undefined, date: string) {
    // Text, inequalities and missing values must never become numeric measurements.
    if (!value?.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()) || !Number.isFinite(Number(value))) return;
    const groupKey = `${key}\u001f${unit}`;
    const group = groups.get(groupKey) || { label, unit, points: [] };
    group.points.push({ value: Number(value), date });
    groups.set(groupKey, group);
  }
  for (const visit of visits.filter(v => v.status !== "CANCELLED")) {
    for (const observation of visit.triage?.observations || [])
      add(`vital:${observation.code}`, labels[observation.code] || observation.code, observation.unit || "", observation.valueDecimal, observation.recordedAt || visit.arrivedAt);
    for (const order of visit.orders || []) {
      if (order.laboratory?.result?.status !== "VERIFIED") continue;
      for (const item of order.laboratory.result.items)
        add(`lab:${order.laboratory.testCode || order.displayName}:${item.analyte}`, `${order.displayName} · ${item.analyte}`, item.unit || "", item.value, visit.arrivedAt);
    }
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group, points: group.points.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)) })).filter(row => row.points.length > 1);
}

export default function PatientTrends({ visits }: { visits: TrendVisit[] }) {
  const rows = patientTrendRows(visits);
  return <details className="card historyPanel">
    <summary><strong>Measurements over time</strong><span>{rows.length} comparable measurement(s)</span></summary>
    <p>Latest three recorded values with matching units. Laboratory values are verified results, dated by visit. Review the original reports for method and reference-range changes.</p>
    {!rows.length ? <p>Comparable numeric measurements will appear after repeat observations or verified tests.</p> :
      <div style={{ overflowX: "auto" }}><table className="reportResults"><thead><tr><th>Measurement</th><th>Latest</th><th>Previous</th><th>Earlier</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.key}><th>{row.label}{row.unit ? ` (${row.unit})` : ""}</th>{[0, 1, 2].map(index => <td key={index}>{row.points[index] ? <><strong>{row.points[index].value}</strong><br /><small>{new Date(row.points[index].date).toLocaleDateString("en-GB", { timeZone: "Africa/Nairobi" })}</small></> : "—"}</td>)}</tr>)}
      </tbody></table></div>}
  </details>;
}
