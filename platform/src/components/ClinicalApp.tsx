"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { assessTriageVitals, patientClinicalGroup } from "@/lib/domain";
import ConsultationWorkstation from "@/components/ConsultationWorkstation";
import LaboratoryWorkstation from "@/components/LaboratoryWorkstation";
import PharmacyWorkstation from "@/components/PharmacyWorkstation";
import BillingWorkstation from "@/components/BillingWorkstation";
import VisitSummaryWorkstation from "@/components/VisitSummaryWorkstation";
import ImagingWorkstation from "@/components/ImagingWorkstation";
import InventoryWorkstation from "@/components/InventoryWorkstation";
import ReportingWorkstation from "@/components/ReportingWorkstation";
import AppointmentWorkstation from "@/components/AppointmentWorkstation";
import ServicePointMap from "@/components/ServicePointMap";
import SupplyWorkstation from "@/components/SupplyWorkstation";
import AdminCenter from "@/components/AdminCenter";
import { currentServicePoint, isWaitingOverdue, waitingMinutes, type ServicePointCode } from "@/lib/service-points";
import { jsonRequest } from "@/lib/client-http";

type User = {
  displayName: string;
  email: string;
  facility: { name: string };
  permissions: string[];
  roles?: string[];
};
type Patient = {
  id: string;
  patientNumber: string;
  fullName: string;
  sexAtBirth: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN";
  dateOfBirth?: string | null;
  estimatedAgeYears?: number | null;
  contacts: { value: string }[];
  allergies?: {
    substance: string;
    reaction?: string | null;
    severity?: string | null;
  }[];
};
type Visit = {
  id: string;
  visitNumber: string;
  clinic: string;
  priority: string;
  status: string;
  reason: string;
  arrivedAt: string;
  patient: Patient;
  facility?: { name: string; code: string };
  queues?: { servicePoint: string; status: string; enteredAt?: string }[];
  orders?: {
    id: string;
    type: string;
    status: string;
    priority?: string;
    requestedAt?: string;
    orderedBy?: { displayName: string };
    displayName: string;
    clinicalIndication?: string | null;
    laboratory?: {
      testCode: string;
      specimenType: string;
      result?: {
        status: string;
        reportText?: string | null;
        items: {
          analyte: string;
          value: string;
          unit?: string | null;
          referenceRange?: string | null;
          flag?: string | null;
        }[];
      } | null;
    } | null;
    prescription?: {
      medicineCode: string; dose: string; route: string; frequency: string;
      duration?: string | null; quantity: string; instructions: string;
      dispensedQuantity?: string | null; dispenseStatus: string;
      dispenseNotes?: string | null; dispensedAt?: string | null;
      dispensedBy?: { displayName: string } | null;
    } | null;
  }[];
  invoice?: {
    id: string; invoiceNumber: string; status: string; currency: string;
    items: { id: string; serviceCode: string; description: string; quantity: string; unitPrice: string }[];
    payments: { id: string; method: string; status: string; amount: string; externalReference?: string | null; receivedAt: string; reversalReason?: string | null; receipt?: { receiptNumber: string; issuedAt: string } | null }[];
    claims: { id: string; payer: string; memberNumber: string; claimNumber: string; amount: string; status: string; notes?: string | null; createdAt: string }[];
  } | null;
};
type Screen =
  | "dashboard"
  | "registration"
  | "appointments"
  | "flow"
  | "visit"
  | "triage"
  | "consultation"
  | "diagnostics"
  | "imaging"
  | "pharmacy"
  | "inventory"
  | "supply"
  | "billing"
  | "summaries"
  | "reports"
  | "admin";

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  return jsonRequest<T>(url, options);
}

export default function ClinicalApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [appointment, setAppointment] = useState<{ id: string; clinic: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [focusedVisitId, setFocusedVisitId] = useState<string | null>(null);
  const [contextVisitId, setContextVisitId] = useState<string | null>(null);
  const loadVisits = useCallback(
    async () =>
      setVisits((await api<{ visits: Visit[] }>("/api/visits")).visits),
    [],
  );

  useEffect(() => {
    api<{ user: User }>("/api/auth/me")
      .then(async (result) => {
        setUser(result.user);
        await loadVisits();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [loadVisits]);
  useEffect(() => {
    const titles: Record<Screen, string> = {
      dashboard: "Home",
      registration: "Patient registration",
      appointments: "Appointments",
      flow: "Patient flow",
      visit: "Clinic check-in",
      triage: "Triage",
      consultation: "Consultation",
      diagnostics: "Laboratory",
      imaging: "Imaging",
      pharmacy: "Pharmacy",
      inventory: "Inventory",
      supply: "Supply chain",
      billing: "Billing",
      summaries: "Patient records",
      reports: "Reports",
      admin: "Administration",
    };
    document.title = `${titles[screen]} · Mwein HMIS`;
  }, [screen]);
  if (loading)
    return (
      <main className="login">
        <div className="formCard">
          <h1>Mwein HMIS</h1>
          <p>Opening your clinical workspace…</p>
        </div>
      </main>
    );
  if (!user)
    return (
      <Login
        onLogin={async (value) => {
          setUser(value);
          await loadVisits();
        }}
      />
    );

  const openVisit = (patient?: Patient) => {
    setSelected(patient || null);
    setScreen("visit");
    setNotice("");
  };
  const allNav: [Screen, string, string?][] = [
    ["dashboard", "Home"],
    ["flow", "Patient flow", "visit.read"],
    ["registration", "Registration", "patient.create"],
    ["appointments", "Appointments", "visit.create"],
    ["triage", "Triage", "triage.write"],
    ["consultation", "Consultation", "encounter.write"],
    ["diagnostics", "Laboratory", "laboratory.write"],
    ["imaging", "Imaging", "imaging.write"],
    ["pharmacy", "Pharmacy", "pharmacy.dispense"],
    ["inventory", "Inventory", "inventory.view"],
    ["supply", "Procurement", "inventory.view"],
    ["billing", "Billing", "billing.read"],
    ["summaries", "Patient records", "patient.read"],
  ];
  const nav: [Screen, string][] = allNav.filter(([, , permission]) => !permission || user.permissions.includes(permission)).map(([key, label]) => [key, label]);
  if ((user.permissions || []).includes("billing.read"))
    nav.push(["reports", "Reports"]);
  if ((user.permissions || []).includes("admin.dashboard"))
    nav.push(["admin", "Administration"]);
  return (
    <main className="shell">
      <button className="mobileNavToggle" aria-expanded={mobileNavOpen} aria-controls="main-navigation" onClick={() => setMobileNavOpen(value => !value)}>{mobileNavOpen ? "Close menu" : "☰ Menu"}</button>
      {mobileNavOpen && <button className="navScrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "mobileOpen" : ""}`} id="main-navigation">
        <div className="brand">
          <span>M</span>
          <div>
            <strong>Mwein HMIS</strong>
            <small>Exceptional care close to you.</small>
          </div>
        </div>
        <nav>
          {nav.map(([key, label]) => (
            <button
              className={screen === key ? "active" : ""}
              onClick={() => { setScreen(key); setFocusedVisitId(null); setContextVisitId(null); setMobileNavOpen(false); }}
              key={key}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="facility">
          <small>Signed in as</small>
          <strong>{user.displayName}</strong>
          <span>{user.facility.name}</span>
          <button
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST" });
              location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <section className="workspace">
        {screen !== "dashboard" &&
          !["summaries", "reports", "appointments", "flow", "admin"].includes(screen) && (
            <WorkflowSteps screen={screen} />
          )}{" "}
        {contextVisitId && (() => { const visit = visits.find(item => item.id === contextVisitId); return visit ? <PatientContextBar visit={visit} onClear={() => setContextVisitId(null)} /> : null; })()}
        {notice && <div className="alert success">{notice}</div>}
        {screen === "dashboard" && (
          <Dashboard
            visits={visits}
            user={user}
            onStart={() => {
              setScreen("registration");
              setNotice("");
            }}
            onOpenTask={(target, visitId) => { setFocusedVisitId(visitId); setContextVisitId(visitId); setScreen(target); }}
          />
        )}
        {screen === "flow" && (
          <ServicePointMap visits={visits} onOpen={(target, visitId) => {
            const targetScreen = target as Screen;
            if (!nav.some(([key]) => key === targetScreen)) return setNotice("This task belongs to another service-point role.");
            setFocusedVisitId(visitId || null); setContextVisitId(visitId || null); setScreen(targetScreen);
          }} />
        )}
        {screen === "registration" && (
          <PatientRegister
            onRegistered={(patient) => {
              setSelected(patient);
              setNotice(
                `${patient.fullName} registered as ${patient.patientNumber}.`,
              );
              setScreen("visit");
            }}
            onStart={openVisit}
          />
        )}
        {screen === "appointments" && (
          <AppointmentWorkstation
            onCheckIn={(booked) => {
              setSelected(booked.patient);
              setAppointment({ id: booked.id, clinic: booked.clinic });
              setNotice(`Confirm check-in for ${booked.patient.fullName}.`);
              setScreen("visit");
            }}
          />
        )}
        {screen === "visit" && (
          <StartVisit
            patient={selected}
            appointment={appointment}
            onCreated={async (visit) => {
              await loadVisits();
              setAppointment(null);
              setNotice(`${visit.visitNumber} started and sent to triage.`);
              setScreen("triage");
            }}
          />
        )}
        {screen === "triage" && (
          <TriageWorkstation
            visits={visits.filter(
              (visit) => visit.status === "AWAITING_TRIAGE",
            )}
            onCompleted={async (patientName) => {
              await loadVisits();
              setNotice(
                `Triage completed for ${patientName}; the patient is now awaiting consultation.`,
              );
              setFocusedVisitId(null); setContextVisitId(null); setScreen("triage");
            }}
            initialVisitId={focusedVisitId}
            onInitialVisitOpened={() => setFocusedVisitId(null)}
          />
        )}
        {screen === "consultation" && (
          <ConsultationWorkstation
            visits={visits.filter((visit) =>
              ["AWAITING_CLINICIAN", "UNDER_CONSULTATION"].includes(
                visit.status,
              ),
            )}
            onCompleted={async (patientName) => {
              await loadVisits();
              setNotice(
                `Consultation signed for ${patientName}; orders and billing have been updated.`,
              );
              setFocusedVisitId(null); setContextVisitId(null); setScreen("consultation");
            }}
            initialVisitId={focusedVisitId}
            onInitialVisitOpened={() => setFocusedVisitId(null)}
          />
        )}
        {screen === "diagnostics" && (
          <LaboratoryWorkstation visits={visits} onUpdated={loadVisits} initialVisitId={focusedVisitId} onInitialVisitOpened={() => setFocusedVisitId(null)} />
        )}{" "}
        {screen === "imaging" && <ImagingWorkstation visits={visits} onUpdated={loadVisits} initialVisitId={focusedVisitId} onInitialVisitOpened={() => setFocusedVisitId(null)} />}
        {screen === "pharmacy" && (
          <PharmacyWorkstation visits={visits} onUpdated={loadVisits} initialVisitId={focusedVisitId} onInitialVisitOpened={() => setFocusedVisitId(null)} />
        )}
        {screen === "inventory" && <InventoryWorkstation />}
        {screen === "supply" && <SupplyWorkstation permissions={user.permissions} />}
        {screen === "billing" && (
          <BillingWorkstation visits={visits} onUpdated={loadVisits} initialVisitId={focusedVisitId} onInitialVisitOpened={() => setFocusedVisitId(null)} />
        )}
        {screen === "summaries" && <VisitSummaryWorkstation canAddendum={user.permissions.includes("encounter.write")} />}
        {screen === "reports" && <ReportingWorkstation />}
        {screen === "admin" && <AdminCenter permissions={user.permissions} />}
        {!(
          [
            "dashboard",
            "registration",
            "appointments",
            "flow",
            "visit",
            "triage",
            "consultation",
            "diagnostics",
            "imaging",
            "pharmacy",
            "inventory",
            "supply",
            "billing",
            "summaries",
            "reports",
            "admin",
          ] as Screen[]
        ).includes(screen) && <Workstation screen={screen} visits={visits} />}
      </section>
    </main>
  );
}

function WorkflowSteps({ screen }: { screen: Screen }) {
  const stages = [
    {
      keys: ["registration", "visit"],
      number: 1,
      label: "Reception",
      detail: "Register & check in",
    },
    {
      keys: ["triage"],
      number: 2,
      label: "Triage",
      detail: "Vitals & priority",
    },
    {
      keys: ["consultation"],
      number: 3,
      label: "Consultation",
      detail: "Complaint, examination & plan",
    },
    {
      keys: ["diagnostics", "imaging", "pharmacy", "inventory", "billing"],
      number: 4,
      label: "Complete visit",
      detail: "Orders, medicines & billing",
    },
  ];
  const current = stages.findIndex((stage) => stage.keys.includes(screen));
  return (
    <ol className="workflowSteps" aria-label="Patient visit workflow">
      {stages.map((stage, index) => (
        <li
          className={
            index === current ? "current" : index < current ? "complete" : ""
          }
          key={stage.number}
        >
          <b>{index < current ? "✓" : stage.number}</b>
          <span>
            <strong>{stage.label}</strong>
            <small>{stage.detail}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      onLogin(
        (
          await api<{ user: User }>("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
              email: form.get("email"),
              password: form.get("password"),
            }),
          })
        ).user,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="login">
      <form className="formCard" onSubmit={submit}>
        <div className="brand dark">
          <span>M</span>
          <div>
            <strong>Mwein HMIS</strong>
            <small>Secure clinical workspace</small>
          </div>
        </div>
        <h1>Welcome back</h1>
        <p>Sign in with your staff account to continue.</p>
        {error && <div className="alert">{error}</div>}
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button className="primary">Sign in</button>
      </form>
    </main>
  );
}

function Dashboard({
  visits,
  user,
  onStart,
  onOpenTask,
}: {
  visits: Visit[];
  user: User;
  onStart: () => void;
  onOpenTask: (screen: Screen, visitId: string) => void;
}) {
  const access: Partial<Record<ServicePointCode, { permission: string; screen: Screen; action: string }>> = {
    TRIAGE: { permission: "triage.write", screen: "triage", action: "Start triage" },
    CONSULTATION: { permission: "encounter.write", screen: "consultation", action: "Open consultation" },
    LABORATORY: { permission: "laboratory.write", screen: "diagnostics", action: "Open laboratory" },
    IMAGING: { permission: "imaging.write", screen: "imaging", action: "Open imaging" },
    PHARMACY: { permission: "pharmacy.dispense", screen: "pharmacy", action: "Dispense" },
    BILLING: { permission: "billing.read", screen: "billing", action: "Receive payment" },
  };
  const priorityRank: Record<string, number> = { EMERGENCY: 0, URGENT: 1, PRIORITY: 2, ROUTINE: 3 };
  const tasks = visits.map(visit => ({ visit, point: currentServicePoint(visit), wait: waitingMinutes(visit) }))
    .filter(item => item.point && user.permissions.includes(access[item.point]?.permission || ""))
    .sort((a, b) => priorityRank[a.visit.priority] - priorityRank[b.visit.priority] || b.wait - a.wait);
  const financial = visits.reduce((totals, visit) => {
    const billed = visit.invoice?.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0) || 0;
    const paid = visit.invoice?.payments.filter(item => item.status === "CONFIRMED").reduce((sum, item) => sum + Number(item.amount), 0) || 0;
    const claims = visit.invoice?.claims.filter(item => !["PAID", "REJECTED", "CANCELLED"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0) || 0;
    return { billed: totals.billed + billed, paid: totals.paid + paid, claims: totals.claims + claims };
  }, { billed: 0, paid: 0, claims: 0 });
  const serviceCounts = tasks.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.point!]: (counts[item.point!] || 0) + 1 }), {});
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Clinical operations</p>
          <h1>My work now</h1>
          <p>{user.roles?.join(" · ") || "Clinical operations"} · tasks are ordered by urgency and waiting time.</p>
        </div>
        {user.permissions.includes("patient.create") && <button className="new" onClick={onStart}>
          + Reception / register patient
        </button>}
      </header>
      <div className="metrics">
        <article>
          <small>My open tasks</small>
          <strong>{tasks.length}</strong>
          <span>At your service points</span>
        </article>
        <article>
          <small>Emergency</small>
          <strong>
            {visits.filter((v) => v.priority === "EMERGENCY").length}
          </strong>
          <span>Immediate response required</span>
        </article>
        <article>
          <small>Overdue</small>
          <strong>{tasks.filter(item => isWaitingOverdue(item.visit.priority, item.wait)).length}</strong>
          <span>Needs attention now</span>
        </article>
        <article>
          <small>Facility active</small>
          <strong>{visits.length}</strong>
          <span>Across all service points</span>
        </article>
      </div>
      <section className="dashboardInsights">
        <article className="card"><div className="cardHead"><div><h2>Work by service point</h2><p>Current actionable load for your role.</p></div></div>{Object.keys(serviceCounts).length ? Object.entries(serviceCounts).map(([point, count]) => <div className="summaryLine" key={point}><strong>{point.replaceAll("_", " ")}</strong><span>{count} waiting</span></div>) : <p>No work waiting.</p>}</article>
        {user.permissions.includes("billing.read") && <article className="card"><div className="cardHead"><div><h2>Active-visit finance</h2><p>Live exposure from currently active patient visits.</p></div></div><div className="summaryLine"><strong>Billed</strong><span>KES {financial.billed.toLocaleString()}</span></div><div className="summaryLine"><strong>Collected</strong><span>KES {financial.paid.toLocaleString()}</span></div><div className="summaryLine"><strong>Patient balance</strong><span>KES {Math.max(0, financial.billed - financial.paid - financial.claims).toLocaleString()}</span></div><div className="summaryLine"><strong>Claims in process</strong><span>KES {financial.claims.toLocaleString()}</span></div></article>}
      </section>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Next actions</h2>
            <p>Open the patient directly—no module hunting.</p>
          </div>
        </div>
        {tasks.length === 0 ? (
          <div className="empty">
            <strong>Your queue is clear</strong>
            <p>New tasks will appear here when a patient reaches your service point.</p>
          </div>
        ) : (
          <div className="queue">
            {tasks.map(({ visit: v, point, wait }) => { const task = access[point!]; const overdue = isWaitingOverdue(v.priority, wait); return (
              <button className={`row taskRow ${v.priority.toLowerCase()} ${overdue ? "overdue" : ""}`} key={v.id} onClick={() => onOpenTask(task!.screen, v.id)}>
                <span className="dot" />
                <div>
                  <strong>{v.patient.fullName}</strong>
                  <small>
                    {v.patient.patientNumber} · {v.clinic} · {task!.action}
                  </small>
                </div>
                <b>{v.priority}</b><time>{overdue ? "OVERDUE · " : ""}{wait} min</time>
              </button>
            );})}
          </div>
        )}
      </section>
    </>
  );
}

function PatientContextBar({ visit, onClear }: { visit: Visit; onClear: () => void }) {
  const point = currentServicePoint(visit)?.replaceAll("_", " ") || visit.status.replaceAll("_", " ");
  const balance = visit.invoice ? visit.invoice.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0) - visit.invoice.payments.filter(item => item.status === "CONFIRMED").reduce((sum, item) => sum + Number(item.amount), 0) : 0;
  return <aside className="patientContext" aria-label="Current patient context"><div><strong>{visit.patient.fullName}</strong><span>{visit.patient.patientNumber} · {visit.visitNumber} · {visit.clinic}</span></div><div><small>Current location</small><b>{point}</b></div><div><small>Allergies</small><b className={visit.patient.allergies?.length ? "dangerText" : ""}>{visit.patient.allergies?.length ? visit.patient.allergies.map(item => item.substance).join(", ") : "None recorded"}</b></div><div><small>Payment</small><b>{visit.invoice?.status || "OPEN"} · KES {Math.max(0, balance).toLocaleString()}</b></div><button className="contextClose" onClick={onClear} aria-label="Clear patient context">×</button></aside>;
}

function PatientRegister({
  onRegistered,
  onStart,
}: {
  onRegistered: (patient: Patient) => void;
  onStart: (patient: Patient) => void;
}) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState("");
  async function search(value: string) {
    if (value.trim().length < 2) return setPatients([]);
    try {
      setPatients(
        (
          await api<{ patients: Patient[] }>(
            `/api/patients?q=${encodeURIComponent(value)}`,
          )
        ).patients,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const f = new FormData(event.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(f.entries());
    body.treatmentConsent = f.get("treatmentConsent") === "on";
    body.electronicRecordConsent = f.get("electronicRecordConsent") === "on";
    body.messagingConsent = f.get("messagingConsent") === "on";
    if (!body.dateOfBirth) delete body.dateOfBirth;
    if (!body.estimatedAgeYears) delete body.estimatedAgeYears;
    try {
      onRegistered(
        (
          await api<{ patient: Patient }>("/api/patients", {
            method: "POST",
            body: JSON.stringify(body),
          })
        ).patient,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Reception</p>
          <h1>Reception · Patient registration</h1>
          <p>
            Find an existing patient or register a new patient, then continue to
            clinic check-in.
          </p>
        </div>
      </header>
      <section className="card search">
        <label>
          Find an existing patient
          <input
            onChange={(e) => search(e.target.value)}
            placeholder="Name, patient number, phone, National ID or SHA number"
          />
        </label>
        {patients.map((p) => (
          <button
            className="patientResult"
            key={p.id}
            onClick={() => onStart(p)}
          >
            <div>
              <strong>{p.fullName}</strong>
              <small>
                {p.patientNumber} · {patientClinicalGroup(p).label}
              </small>
            </div>
            <span>Check in patient →</span>
          </button>
        ))}
      </section>
      <form className="card dataForm" onSubmit={submit}>
        <div className="wide">
          <h2>Register a new patient</h2>
          <p>Required fields are marked with an asterisk.</p>
          {error && <div className="alert">{error}</div>}
        </div>
        <label className="wide">
          Full name *<input name="fullName" required minLength={3} />
        </label>
        <label>
          Date of birth
          <input name="dateOfBirth" type="date" />
        </label>
        <label>
          Estimated age
          <input name="estimatedAgeYears" type="number" min="0" max="120" />
        </label>
        <label>
          Sex at birth *
          <select name="sexAtBirth" required defaultValue="">
            <option value="" disabled>
              Select
            </option>
            <option>FEMALE</option>
            <option>MALE</option>
            <option>INTERSEX</option>
            <option>UNKNOWN</option>
          </select>
        </label>
        <label>
          Phone *<input name="phone" type="tel" required />
        </label>
        <label>
          National ID
          <input name="nationalId" />
        </label>
        <label>
          SHA number
          <input name="shaNumber" />
        </label>
        <label>
          County *<input name="county" defaultValue="Busia" required />
        </label>
        <label>
          Subcounty *<input name="subcounty" required />
        </label>
        <label>
          Ward
          <input name="ward" />
        </label>
        <label>
          Village
          <input name="village" />
        </label>
        <label>
          Preferred language
          <select name="preferredLanguage">
            <option>English</option>
            <option>Kiswahili</option>
          </select>
        </label>
        <div className="wide checks">
          <label>
            <input name="treatmentConsent" type="checkbox" required /> Consent
            to treatment *
          </label>
          <label>
            <input name="electronicRecordConsent" type="checkbox" required />{" "}
            Consent to electronic record *
          </label>
          <label>
            <input name="messagingConsent" type="checkbox" /> Consent to
            appointment messages
          </label>
        </div>
        <button className="primary wide">Register patient and continue</button>
      </form>
    </>
  );
}

function StartVisit({
  patient,
  appointment,
  onCreated,
}: {
  patient: Patient | null;
  appointment?: { id: string; clinic: string } | null;
  onCreated: (visit: Visit) => void;
}) {
  const [matches, setMatches] = useState<Patient[]>([]);
  const [chosen, setChosen] = useState(patient);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen) return setError("Select a patient first");
    const f = new FormData(event.currentTarget);
    try {
      onCreated(
        (
          await api<{ visit: Visit }>("/api/visits", {
            method: "POST",
            body: JSON.stringify({
              patientId: chosen.id,
              appointmentId: appointment?.id,
              clinic: appointment?.clinic || f.get("clinic"),
              priority:
                f.get("visitType") === "EMERGENCY" ? "EMERGENCY" : "ROUTINE",
              visitType: appointment ? "APPOINTMENT" : f.get("visitType"),
            }),
          })
        ).visit,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Reception</p>
          <h1>Clinic check-in</h1>
          <p>
            Confirm the destination clinic and arrival type, then send the
            registered patient to triage.
          </p>
        </div>
      </header>
      <form className="card dataForm" onSubmit={submit}>
        {error && <div className="alert wide">{error}</div>}
        {chosen ? (
          <div className="patientBanner wide">
            <div>
              <strong>{chosen.fullName}</strong>
              <span>
                {chosen.patientNumber} · {patientClinicalGroup(chosen).label}
              </span>
            </div>
            <button type="button" onClick={() => setChosen(null)}>
              Change patient
            </button>
          </div>
        ) : (
          <label className="wide">
            Search patient *
            <input
              placeholder="Name, patient number or phone"
              onChange={async (e) => {
                if (e.target.value.length >= 2)
                  setMatches(
                    (
                      await api<{ patients: Patient[] }>(
                        `/api/patients?q=${encodeURIComponent(e.target.value)}`,
                      )
                    ).patients,
                  );
              }}
            />
            {matches.map((p) => (
              <button
                type="button"
                className="patientResult"
                onClick={() => {
                  setChosen(p);
                  setMatches([]);
                }}
                key={p.id}
              >
                <strong>{p.fullName}</strong>
                <span>{p.patientNumber}</span>
              </button>
            ))}
          </label>
        )}
        <label>
          Clinic *
          <select name="clinic" defaultValue={appointment?.clinic || "Outpatient"} disabled={Boolean(appointment)}>
            {[
              "Outpatient",
              "ANC",
              "HTN",
              "DM",
              "Paediatrics",
              "Emergency",
              "Other",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Arrival type *
          <select name="visitType" defaultValue={appointment ? "APPOINTMENT" : "WALK_IN"} disabled={Boolean(appointment)}>
            <option value="WALK_IN">Walk-in</option>
            <option value="APPOINTMENT">Appointment</option>
            <option value="EMERGENCY">Emergency</option>
          </select>
        </label>
        <div className="privacyNotice wide">
          <strong>Privacy by design</strong>
          <span>
            Do not ask or record symptoms at reception. The clinician will
            obtain the complaint and history in the consultation room.
          </span>
        </div>
        <button className="primary wide">Check in and send to triage</button>
      </form>
    </>
  );
}

function TriageWorkstation({
  visits,
  onCompleted,
  initialVisitId,
  onInitialVisitOpened,
}: {
  visits: Visit[];
  onCompleted: (patientName: string) => void;
  initialVisitId?: string | null;
  onInitialVisitOpened?: () => void;
}) {
  const [active, setActive] = useState<Visit | null>(null);
  const [error, setError] = useState("");
  const [vitals, setVitals] = useState({
    temperatureC: 36.5,
    pulseBpm: 80,
    respiratoryRate: 18,
    systolicBp: 120,
    diastolicBp: 80,
    oxygenSaturation: 98,
    painScore: 0,
    consciousness: "ALERT" as "ALERT" | "VOICE" | "PAIN" | "UNRESPONSIVE",
  });
  const alerts = useMemo(() => assessTriageVitals(vitals), [vitals]);
  useEffect(() => {
    if (!initialVisitId) return;
    const visit = visits.find(item => item.id === initialVisitId);
    if (visit) { setActive(visit); onInitialVisitOpened?.(); }
  }, [initialVisitId, visits, onInitialVisitOpened]);
  function vital(name: keyof typeof vitals, value: string) {
    setVitals((current) => ({
      ...current,
      [name]: name === "consciousness" ? value : Number(value),
    }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    setError("");
    const f = new FormData(event.currentTarget);
    try {
      await api(`/api/visits/${active.id}/triage`, {
        method: "POST",
        body: JSON.stringify({
          ...vitals,
          weightKg: f.get("weightKg"),
          heightCm: f.get("heightCm") || undefined,
          triageCategory: f.get("triageCategory"),
          pregnancyStatus: f.get("pregnancyStatus") || undefined,
          lastMenstrualPeriod: f.get("lastMenstrualPeriod") || undefined,
          notes: f.get("notes") || undefined,
        }),
      });
      onCompleted(active.patient.fullName);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!active)
    return (
      <>
        <header>
          <div>
            <p className="eyebrow">Triage workstation</p>
            <h1>Waiting for triage</h1>
            <p>
              Select the next patient. Only minimum identifying information is
              displayed.
            </p>
          </div>
        </header>
        <section className="card">
          {visits.length === 0 ? (
            <div className="empty">
              <strong>No patients awaiting triage</strong>
              <p>Newly registered visits will appear here automatically.</p>
            </div>
          ) : (
            <div className="queue">
              {visits.map((v) => (
                <button
                  className={`row ${v.priority.toLowerCase()}`}
                  onClick={() => setActive(v)}
                  key={v.id}
                >
                  <span className="dot" />
                  <div>
                    <strong>{v.patient.fullName}</strong>
                    <small>
                      {v.patient.patientNumber} ·{" "}
                      {patientClinicalGroup(v.patient).label} · {v.clinic}
                    </small>
                  </div>
                  <b>{v.priority}</b>
                  <time>
                    {new Date(v.arrivedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </button>
              ))}
            </div>
          )}
        </section>
      </>
    );
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Triage assessment</p>
          <h1>{active.patient.fullName}</h1>
          <p>
            {active.patient.patientNumber} · {active.visitNumber} ·{" "}
            {active.clinic}
          </p>
        </div>
        <button className="secondary" onClick={() => setActive(null)}>
          ← Back to queue
        </button>
      </header>
      <div className={`patientBanner ${active.priority.toLowerCase()}`}>
        <div>
          <strong>Arrival priority: {active.priority}</strong>
          <span>
            {patientClinicalGroup(active.patient).label} · {active.clinic}
          </span>
        </div>
        <time>
          Arrived{" "}
          {new Date(active.arrivedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      {active.patient.allergies?.length ? (
        <div className="allergyAlert">
          <strong>Allergy alert</strong>
          {active.patient.allergies.map((a) => (
            <span key={a.substance}>
              {a.substance}
              {a.reaction ? ` — ${a.reaction}` : ""}
            </span>
          ))}
        </div>
      ) : null}
      <form className="card dataForm triageForm" onSubmit={submit}>
        {error && <div className="alert wide">{error}</div>}
        <div className="privacyNotice wide">
          <strong>Clinical privacy</strong>
          <span>
            Do not ask for the complaint or history here. Record only immediate
            safety observations; the clinician will document sensitive details
            in private.
          </span>
        </div>
        <fieldset className="wide vitalGrid">
          <legend>Vital signs</legend>
          <label>
            Temperature °C
            <input
              type="number"
              step="0.1"
              min="25"
              max="45"
              value={vitals.temperatureC}
              onChange={(e) => vital("temperatureC", e.target.value)}
              required
            />
          </label>
          <label>
            Pulse /min
            <input
              type="number"
              min="20"
              max="300"
              value={vitals.pulseBpm}
              onChange={(e) => vital("pulseBpm", e.target.value)}
              required
            />
          </label>
          <label>
            Respirations /min
            <input
              type="number"
              min="4"
              max="100"
              value={vitals.respiratoryRate}
              onChange={(e) => vital("respiratoryRate", e.target.value)}
              required
            />
          </label>
          <label>
            BP systolic
            <input
              type="number"
              min="40"
              max="300"
              value={vitals.systolicBp}
              onChange={(e) => vital("systolicBp", e.target.value)}
              required
            />
          </label>
          <label>
            BP diastolic
            <input
              type="number"
              min="20"
              max="200"
              value={vitals.diastolicBp}
              onChange={(e) => vital("diastolicBp", e.target.value)}
              required
            />
          </label>
          <label>
            SpO₂ %
            <input
              type="number"
              min="40"
              max="100"
              value={vitals.oxygenSaturation}
              onChange={(e) => vital("oxygenSaturation", e.target.value)}
              required
            />
          </label>
          <label>
            Weight kg
            <input
              name="weightKg"
              type="number"
              step="0.1"
              min="0.1"
              max="500"
              required
            />
          </label>
          <label>
            Height cm
            <input
              name="heightCm"
              type="number"
              step="0.1"
              min="20"
              max="260"
            />
          </label>
          <label>
            Pain /10
            <input
              type="number"
              min="0"
              max="10"
              value={vitals.painScore}
              onChange={(e) => vital("painScore", e.target.value)}
              required
            />
          </label>
          <label>
            Consciousness
            <select
              value={vitals.consciousness}
              onChange={(e) => vital("consciousness", e.target.value)}
            >
              <option value="ALERT">Alert</option>
              <option value="VOICE">Responds to voice</option>
              <option value="PAIN">Responds to pain</option>
              <option value="UNRESPONSIVE">Unresponsive</option>
            </select>
          </label>
        </fieldset>
        {alerts.length > 0 && (
          <div className="dangerPanel wide">
            <strong>Rule-based clinical alerts — assess immediately</strong>
            {alerts.map((alert) => (
              <span
                className={alert.severity.toLowerCase()}
                key={alert.message}
              >
                {alert.severity}: {alert.message}
              </span>
            ))}
            <small>
              These alerts support, but do not replace, clinical judgement or
              local emergency protocols.
            </small>
          </div>
        )}
        {patientClinicalGroup(active.patient).pregnancyQuestionsApply && (
          <>
            <label>
              Pregnancy status
              <select name="pregnancyStatus">
                <option value="UNKNOWN">Ask privately</option>
                <option value="NOT_PREGNANT">Not pregnant</option>
                <option value="PREGNANT">Pregnant</option>
                <option value="POSSIBLY_PREGNANT">Possibly pregnant</option>
              </select>
            </label>
            <label>
              Last menstrual period
              <input name="lastMenstrualPeriod" type="date" />
            </label>
          </>
        )}
        {patientClinicalGroup(active.patient).ageGroup === "CHILD" && (
          <div className="childNotice">
            <strong>Paediatric patient</strong>
            <span>
              Use age-appropriate equipment and local paediatric observation
              ranges. Confirm the accompanying caregiver.
            </span>
          </div>
        )}
        <label>
          Triage category *
          <select name="triageCategory" defaultValue={active.priority}>
            <option value="ROUTINE">Green · Routine</option>
            <option value="PRIORITY">Yellow · Priority</option>
            <option value="URGENT">Orange · Urgent</option>
            <option value="EMERGENCY">Red · Emergency</option>
          </select>
        </label>
        <label className="wide">
          Triage notes
          <textarea name="notes" rows={3} />
        </label>
        <div className="wide submitBar">
          <span>
            Completing triage will route this patient to consultation.
          </span>
          <button className="primary">Complete triage</button>
        </div>
      </form>
    </>
  );
}

function Workstation({ screen, visits }: { screen: Screen; visits: Visit[] }) {
  const labels: Record<string, string> = {
    triage: "Triage queue",
    consultation: "Consultation",
    diagnostics: "Laboratory & imaging",
    pharmacy: "Pharmacy",
    billing: "Billing",
  };
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Clinical workstation</p>
          <h1>{labels[screen]}</h1>
          <p>This service view follows the same patient visit.</p>
        </div>
      </header>
      <section className="card">
        <h2>
          {visits.length} active visit{visits.length === 1 ? "" : "s"}
        </h2>
        <p>
          The next build step adds documentation and visit-routing controls
          here.
        </p>
        <div className="queue compact">
          {visits.map((v) => (
            <div className={`row ${v.priority.toLowerCase()}`} key={v.id}>
              <span className="dot" />
              <div>
                <strong>{v.patient.fullName}</strong>
                <small>
                  {v.clinic} · {v.status.replaceAll("_", " ")}
                </small>
              </div>
              <b>{v.priority}</b>
              <time>{v.visitNumber}</time>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
