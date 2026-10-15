import { RecordFields } from "./RecordFields";

type JourneyVisit = {
  arrivedAt: string; status: string; clinicallyClosedAt?: string | null;
  triage?: object | null;
  encounters?: { status?: string }[];
  orders?: { type: string; status: string }[];
};

// Render only the clinical fields already authorised by the worklist projection.
// A later screen or visit status is never proof that an earlier assessment exists.
export function PatientJourney({ visit }: { visit: JourneyVisit }) {
  const signed = visit.encounters?.some(encounter => ["SIGNED", "CORRECTED"].includes(encounter.status || ""));
  const services = (type: string[]) => {
    const orders = visit.orders?.filter(order => type.includes(order.type));
    if (!orders?.length) return "No orders recorded";
    const pending = orders.filter(order => ["DRAFT", "REQUESTED", "IN_PROGRESS"].includes(order.status)).length;
    const cancelled = orders.filter(order => order.status === "CANCELLED").length;
    return `${orders.length - pending - cancelled} completed · ${pending} pending · ${cancelled} cancelled`;
  };
  return <section className="card patientJourney" aria-label="Saved patient journey">
    <RecordFields title="Patient journey · saved records" fields={[
      { label: "Registration & check-in", value: visit.arrivedAt ? `Visit opened ${new Date(visit.arrivedAt).toLocaleString()}` : "Arrival time not recorded" },
      { label: "Triage", value: visit.triage ? "Assessment recorded" : "No assessment recorded; review the clinic pathway" },
      { label: "Consultation", value: signed ? "Signed clinical assessment" : visit.encounters?.length ? "Draft assessment; signature pending" : "No assessment recorded" },
      { label: "Laboratory & imaging", value: services(["LABORATORY", "IMAGING"]) },
      { label: "Medicines", value: services(["MEDICATION"]) },
      { label: "Clinical discharge", value: visit.clinicallyClosedAt ? `Recorded ${new Date(visit.clinicallyClosedAt).toLocaleString()}` : visit.status === "ADMITTED" ? "Admitted; clinical handover and subsequent closure required" : visit.status === "CANCELLED" ? "Visit cancelled; this is not a clinical discharge" : signed ? "Awaiting explicit clinical discharge and follow-up plan" : "Clinical assessment required before discharge" },
      { label: "Financial completion", value: visit.status === "COMPLETED" ? "Visit completed" : "Separate billing review; does not prevent clinical discharge" },
    ]}/>
  </section>;
}
