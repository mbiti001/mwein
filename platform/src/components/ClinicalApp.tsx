"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { assessTriageVitals, patientClinicalGroup } from "@/lib/domain";
import type { StockFocus } from "@/components/InventoryWorkstation";
import SaveFeedback from "@/components/SaveFeedback";
import { currentServicePoint, isWaitingOverdue, waitingMinutes, type ServicePointCode } from "@/lib/service-points";
import { appointmentClinics } from "@/lib/appointments";
import { careServiceForClinic } from "@/lib/care-service-points";
import { jsonRequest } from "@/lib/client-http";

const workspaceLoading = () => <section className="card"><p>Opening workspace…</p></section>;
const ConsultationWorkstation = dynamic(() => import("@/components/ConsultationWorkstation"), { loading: workspaceLoading });
const LaboratoryWorkstation = dynamic(() => import("@/components/LaboratoryWorkstation"), { loading: workspaceLoading });
const PharmacyCenter = dynamic(() => import("@/components/PharmacyCenter"), { loading: workspaceLoading });
const BillingWorkstation = dynamic(() => import("@/components/BillingWorkstation"), { loading: workspaceLoading });
const VisitSummaryWorkstation = dynamic(() => import("@/components/VisitSummaryWorkstation"), { loading: workspaceLoading });
const ImagingWorkstation = dynamic(() => import("@/components/ImagingWorkstation"), { loading: workspaceLoading });
const ReportingWorkstation = dynamic(() => import("@/components/ReportingWorkstation"), { loading: workspaceLoading });
const AppointmentWorkstation = dynamic(() => import("@/components/AppointmentWorkstation"), { loading: workspaceLoading });
const AdminCenter = dynamic(() => import("@/components/AdminCenter"), { loading: workspaceLoading });
const ServicePointsWorkstation = dynamic(() => import("@/components/ServicePointsWorkstation"), { loading: workspaceLoading });
const QueueOperationsPanel = dynamic(() => import("@/components/QueueOperationsPanel"), { loading: workspaceLoading });
const FollowUpWorkstation = dynamic(() => import("@/components/FollowUpWorkstation"), { loading: workspaceLoading });

type User = {
  displayName: string;
  email: string;
  facility: { name: string };
  permissions: string[];
  roles?: string[];
  mustChangePassword: boolean;
};
type Patient = {
  id: string;
  patientNumber: string;
  fullName: string;
  sexAtBirth: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN";
  dateOfBirth?: string | null;
  estimatedAgeYears?: number | null;
  contacts?: { value: string }[];
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
  visitType?: string;
  priority: string;
  status: string;
  reason?: string;
  arrivedAt: string;
  patient: Patient;
  encounters?: {
    diagnoses: { description: string; code?: string | null; primary: boolean }[];
  }[];
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
        id: string;
        status: string;
        verifiedAt?: string | null;
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
    imaging?: {
      examinationCode: string;
      modality: string;
      result?: {
        id: string;
        status: string;
        verifiedAt?: string | null;
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
    claims: { id: string; payer: string; memberNumber: string; claimNumber: string; amount: string; status: string; notes?: string | null; createdAt: string; lines?: { invoiceItemId: string; amount: string }[] }[];
  } | null;
};
type Screen =
  | "dashboard"
  | "registration"
  | "appointments"
  | "visit"
  | "triage"
  | "servicePoints"
  | "consultation"
  | "diagnostics"
  | "imaging"
  | "pharmacy"
  | "billing"
  | "summaries"
  | "followUps"
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
  const [stockFocus, setStockFocus] = useState<StockFocus | null>(null);
  const loadVisits = useCallback(
    async () =>
      setVisits((await api<{ visits: Visit[] }>("/api/visits")).visits),
    [],
  );

  useEffect(() => {
    api<{ user: User }>("/api/auth/me")
      .then(async (result) => {
        setUser(result.user);
        if (!result.user.mustChangePassword && result.user.permissions.includes("visit.read")) await loadVisits();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [loadVisits]);
  useEffect(() => {
    if (!user || user.mustChangePassword || !user.permissions.includes("visit.read")) return;
    let stopped = false;
    const refresh = () => {
      if (!stopped && document.visibilityState === "visible")
        void loadVisits().catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadVisits, user]);
  useEffect(() => {
    const titles: Record<Screen, string> = {
      dashboard: "Home",
      registration: "Patient registration",
      appointments: "Appointments",
      visit: "Clinic check-in",
      triage: "Triage",
      servicePoints: "Service points",
      consultation: "Consultation",
      diagnostics: "Laboratory",
      imaging: "Imaging",
      pharmacy: "Pharmacy & stock",
      billing: "Billing",
      summaries: "Patient records",
      followUps: "Follow-up work",
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
          if (!value.mustChangePassword && value.permissions.includes("visit.read")) await loadVisits();
        }}
      />
    );
  if (user.mustChangePassword)
    return <PasswordChange onChanged={async () => {
      const result = await api<{ user: User }>("/api/auth/me");
      setUser(result.user);
      if (result.user.permissions.includes("visit.read")) await loadVisits();
    }} />;

  const openVisit = (patient?: Patient) => {
    setSelected(patient || null);
    setScreen("visit");
    setNotice("");
  };
  const allNav: [Screen, string, string?][] = [
    ["dashboard", "Home"],
    ["registration", "Registration", "patient.create"],
    ["appointments", "Appointments", "visit.create"],
    ["followUps", "Follow-up work", "visit.read"],
    ["triage", "Triage", "triage.write"],
    ["servicePoints", "Service points", "encounter.write"],
    ["consultation", "Consultation", "encounter.write"],
    ["diagnostics", "Laboratory", "laboratory.write"],
    ["imaging", "Imaging", "imaging.write"],
    ["pharmacy", "Pharmacy & stock", "inventory.view"],
    ["billing", "Billing", "billing.read"],
    ["summaries", "Patient records", "clinical.summary.read"],
  ];
  const nav: [Screen, string][] = allNav.filter(([, , permission]) => !permission || user.permissions.includes(permission)).map(([key, label]) => [key, label]);
  if ((user.permissions || []).includes("billing.read"))
    nav.push(["reports", "Reports"]);
  if ((user.permissions || []).includes("admin.dashboard"))
    nav.push(["admin", "Administration"]);
  return (
    <main className="shell">
      <SaveFeedback />
      <button className="mobileNavToggle" aria-expanded={mobileNavOpen} aria-controls="main-navigation" onClick={() => setMobileNavOpen(value => !value)}>{mobileNavOpen ? "Close menu" : "☰ Menu"}</button>
      {mobileNavOpen && <button className="navScrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "mobileOpen" : ""}`} id="main-navigation">
        <div className="brand">
          <img className="brandMark" src="/icon.png" alt="" width={42} height={42} aria-hidden="true" />
          <div>
            <strong>Mwein HMIS</strong>
            <small>Exceptional care close to you.</small>
          </div>
        </div>
        <nav>
          {nav.map(([key, label]) => (
            <button
              className={screen === key ? "active" : ""}
              onClick={() => { setScreen(key); setFocusedVisitId(null); setStockFocus(null); setMobileNavOpen(false); }}
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
        {user.permissions.includes("patient.read") && (
          <GlobalPatientFinder onSelect={(patient) => {
            const activeVisit = visits.find(visit => visit.patient.id === patient.id);
            if (activeVisit) {
              setContextVisitId(activeVisit.id);
              setNotice(`${patient.fullName} is open in visit ${activeVisit.visitNumber}. Use “Open current task” to continue.`);
              setScreen("dashboard");
            } else openVisit(patient);
          }}/>
        )}
        {screen !== "dashboard" &&
          !["summaries", "reports", "appointments", "admin"].includes(screen) && (
            <WorkflowSteps screen={screen} />
          )}{" "}
        {contextVisitId && (() => { const visit = visits.find(item => item.id === contextVisitId); return visit ? <PatientContextBar visit={visit} showBalance={user.permissions.includes("billing.read")} onClear={() => setContextVisitId(null)} onOpen={(target) => { setFocusedVisitId(visit.id); setScreen(target); }} /> : null; })()}
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
            onUpdated={loadVisits}
          />
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
              setContextVisitId(visit.id);
              setFocusedVisitId(visit.id);
              const direct = visit.clinic === "Walk-in";
              setNotice(`${visit.visitNumber} started and sent to ${direct ? "the walk-in clinical review" : "triage"}.`);
              setScreen(direct ? "servicePoints" : "triage");
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
        {screen === "servicePoints" && (
          <ServicePointsWorkstation
            visits={visits}
            initialVisitId={focusedVisitId}
            onInitialVisitOpened={() => setFocusedVisitId(null)}
            onOpenClinical={(visitId) => { setFocusedVisitId(visitId); setContextVisitId(visitId); setScreen("consultation"); }}
            onUpdated={loadVisits}
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
            onOpenServicePoints={(visitId) => { setFocusedVisitId(visitId); setContextVisitId(visitId); setScreen("servicePoints"); }}
            initialVisitId={focusedVisitId}
            onInitialVisitOpened={() => setFocusedVisitId(null)}
          />
        )}
        {screen === "diagnostics" && (
          <LaboratoryWorkstation visits={visits} onUpdated={loadVisits} initialVisitId={focusedVisitId} onInitialVisitOpened={() => setFocusedVisitId(null)} />
        )}{" "}
        {screen === "imaging" && <ImagingWorkstation visits={visits} onUpdated={loadVisits} initialVisitId={focusedVisitId} onInitialVisitOpened={() => setFocusedVisitId(null)} />}
        {screen === "pharmacy" && (
          <PharmacyCenter permissions={user.permissions} visits={visits} onUpdated={loadVisits} initialVisitId={focusedVisitId} onInitialVisitOpened={() => setFocusedVisitId(null)} stockFocus={stockFocus} onStockFocusConsumed={() => setStockFocus(null)} />
        )}
        {screen === "billing" && (
          <BillingWorkstation visits={visits} permissions={user.permissions} onUpdated={loadVisits} initialVisitId={focusedVisitId} onInitialVisitOpened={() => setFocusedVisitId(null)} />
        )}
        {screen === "summaries" && <VisitSummaryWorkstation canAddendum={user.permissions.includes("encounter.write")} />}
        {screen === "followUps" && <FollowUpWorkstation/>}
        {screen === "reports" && <ReportingWorkstation />}
        {screen === "admin" && <AdminCenter permissions={user.permissions} onOpenStock={(focus) => { setStockFocus(focus); setFocusedVisitId(null); setScreen("pharmacy"); }} />}
      </section>
    </main>
  );
}

function GlobalPatientFinder({ onSelect }: { onSelect: (patient: Patient) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { if (query.trim().length < 2) { setResults([]); return; } const controller = new AbortController(); const timer = window.setTimeout(() => { api<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then(data => { setResults(data.patients); setError(""); }).catch(reason => { if ((reason as Error).name !== "AbortError") setError("Patient search is temporarily unavailable"); }); }, 250); return () => { clearTimeout(timer); controller.abort(); }; }, [query]);
  return <div className="globalPatientFinder noPrint"><label><span>Find a patient anywhere</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, patient number, phone, National ID or SHA number" autoComplete="off"/></label>{error && <small className="dangerText">{error}</small>}{results.length > 0 && <div className="globalPatientResults">{results.slice(0, 8).map(patient => <button type="button" key={patient.id} onClick={() => { onSelect(patient); setQuery(""); setResults([]); }}><strong>{patient.fullName}</strong><span>{patient.patientNumber} · {patientClinicalGroup(patient).label}</span></button>)}</div>}</div>;
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
      keys: ["servicePoints", "consultation"],
      number: 3,
      label: "Consultation",
      detail: "Complaint, examination & plan",
    },
    {
      keys: ["diagnostics", "imaging", "pharmacy", "billing"],
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
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      onLogin(
        (
          await api<{ user: User }>("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
              facilityCode: form.get("facilityCode"),
              email: form.get("email"),
              password: form.get("password"),
            }),
          })
        ).user,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <main className="publicEntry">
      <nav className="publicNav" aria-label="Public navigation">
        <div className="brand dark">
          <img className="brandMark" src="/icon.png" alt="" width={42} height={42} aria-hidden="true" />
          <div>
            <strong>Mwein HMIS</strong>
            <small>Connected outpatient care</small>
          </div>
        </div>
        <a href="#sign-in">Staff sign in</a>
      </nav>
      <section className="publicHero">
        <div className="heroCopy">
          <p className="eyebrow">Exceptional care, close to you</p>
          <h1>One calm workspace for every outpatient visit.</h1>
          <p className="heroLead">Mwein connects reception, consultation, laboratory, pharmacy, billing and reporting around one patient journey—so teams spend less time searching and more time caring.</p>
          <div className="heroActions">
            <a className="heroPrimary" href="#sign-in">Open clinical workspace</a>
            <span>Secure · Role-based · Audit-ready</span>
          </div>
          <div className="publicFeatures" aria-label="Platform benefits">
            <article><b>01</b><strong>Follow the patient</strong><span>Clear queues and direct handoffs at every service point.</span></article>
            <article><b>02</b><strong>Work safely</strong><span>Clinical checks, duplicate prevention and traceable actions.</span></article>
            <article><b>03</b><strong>Know the facility</strong><span>Live stock, billing and monthly reporting in one system.</span></article>
          </div>
        </div>
        <aside className="loginVisual" id="sign-in">
          <div className="loginImage" role="img" aria-label="Clinician reviewing care information with a patient" />
          <form className="formCard landingLogin" onSubmit={submit}>
            <div><p className="eyebrow">Secure access</p><h2>Welcome back</h2><p>Sign in with your staff account.</p></div>
            {error && <div className="alert" role="alert">{error}</div>}
            <label>Facility code<input name="facilityCode" defaultValue="MMS" autoComplete="organization" required maxLength={30} /></label>
            <label>Email<input name="email" type="email" autoComplete="username" required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
            <button className="primary" disabled={submitting}>{submitting ? "Signing in…" : "Sign in securely"}</button>
            <small className="privacyLine">Authorised facility staff only. All access is recorded.</small>
          </form>
        </aside>
      </section>
      <footer className="publicFooter"><span>© {new Date().getFullYear()} Mwein Medical Services</span><span>Built for clear, connected care.</span></footer>
    </main>
  );
}

function PasswordChange({ onChanged }: { onChanged: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }),
      });
      await onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  return <main className="login"><form className="formCard" onSubmit={submit}>
    <p className="eyebrow">Account security</p><h1>Choose your permanent password</h1>
    <p>Your administrator issued a temporary password. Replace it before opening patient records.</p>
    {error && <div className="alert" role="alert">{error}</div>}
    <label>Temporary password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
    <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={16} required /></label>
    <small>Use at least 16 characters. Changing it signs out your other sessions.</small>
    <button className="primary" disabled={submitting}>{submitting ? "Changing password…" : "Change password"}</button>
  </form></main>;
}

function Dashboard({
  visits,
  user,
  onStart,
  onOpenTask,
  onUpdated,
}: {
  visits: Visit[];
  user: User;
  onStart: () => void;
  onOpenTask: (screen: Screen, visitId: string) => void;
  onUpdated: () => Promise<void>;
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
              <button className={`row taskRow ${v.priority.toLowerCase()} ${overdue ? "overdue" : ""}`} key={v.id} onClick={() => onOpenTask(point === "CONSULTATION" && careServiceForClinic(v.clinic) ? "servicePoints" : task!.screen, v.id)}>
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
      <QueueOperationsPanel permissions={user.permissions} onOpenTask={onOpenTask} onUpdated={onUpdated} />
    </>
  );
}

function PatientContextBar({ visit, showBalance, onClear, onOpen }: { visit: Visit; showBalance: boolean; onClear: () => void; onOpen: (target: Screen) => void }) {
  const servicePoint = currentServicePoint(visit);
  const point = servicePoint?.replaceAll("_", " ") || visit.status.replaceAll("_", " ");
  const targets: Partial<Record<ServicePointCode, Screen>> = { TRIAGE: "triage", CONSULTATION: careServiceForClinic(visit.clinic) ? "servicePoints" : "consultation", LABORATORY: "diagnostics", IMAGING: "imaging", PHARMACY: "pharmacy", BILLING: "billing" };
  const balance = showBalance && visit.invoice ? visit.invoice.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0) - visit.invoice.payments.filter(item => item.status === "CONFIRMED").reduce((sum, item) => sum + Number(item.amount), 0) : 0;
  return <aside className="patientContext" aria-label="Current patient context"><div><strong>{visit.patient.fullName}</strong><span>{visit.patient.patientNumber} · {visit.visitNumber} · {visit.clinic}</span></div><div><small>Current location</small><b>{point}</b></div>{visit.patient.allergies && <div><small>Allergies</small><b className={visit.patient.allergies.length ? "dangerText" : ""}>{visit.patient.allergies.length ? visit.patient.allergies.map(item => item.substance).join(", ") : "None recorded"}</b></div>}{visit.invoice && <div><small>Payment</small><b>{visit.invoice.status}{showBalance ? ` · KES ${Math.max(0, balance).toLocaleString()}` : ""}</b></div>}{servicePoint && targets[servicePoint] && <button className="contextAction" onClick={() => onOpen(targets[servicePoint]!)}>Open current task</button>}<button className="contextClose" onClick={onClear} aria-label="Clear patient context">×</button></aside>;
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
        <label>First name *<input name="givenName" required autoComplete="given-name" /></label>
        <label>Middle name<input name="middleName" autoComplete="additional-name" /></label>
        <label>Surname *<input name="familyName" required autoComplete="family-name" /></label>
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
            Confirm the destination clinic and arrival type. Specialty and
            walk-in services use their focused clinical workflow.
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
            {appointmentClinics.map((x) => (
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
        <button className="primary wide">Check in patient</button>
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
  type TriageDraft = {
    temperatureC: string;
    pulseBpm: string;
    respiratoryRate: string;
    systolicBp: string;
    diastolicBp: string;
    oxygenSaturation: string;
    painScore: string;
    consciousness: "" | "ALERT" | "VOICE" | "PAIN" | "UNRESPONSIVE";
  };
  const blankVitals = (): TriageDraft => ({
    temperatureC: "",
    pulseBpm: "",
    respiratoryRate: "",
    systolicBp: "",
    diastolicBp: "",
    oxygenSaturation: "",
    painScore: "",
    consciousness: "",
  });
  const [active, setActive] = useState<Visit | null>(null);
  const [error, setError] = useState("");
  const [vitals, setVitals] = useState<TriageDraft>(blankVitals);
  const assessedVitals = useMemo(() => {
    if (!vitals.consciousness || Object.entries(vitals).some(([key, value]) => key !== "consciousness" && value === "")) return null;
    return {
      temperatureC: Number(vitals.temperatureC),
      pulseBpm: Number(vitals.pulseBpm),
      respiratoryRate: Number(vitals.respiratoryRate),
      systolicBp: Number(vitals.systolicBp),
      diastolicBp: Number(vitals.diastolicBp),
      oxygenSaturation: Number(vitals.oxygenSaturation),
      painScore: Number(vitals.painScore),
      consciousness: vitals.consciousness,
    };
  }, [vitals]);
  const alerts = useMemo(() => assessedVitals ? assessTriageVitals(assessedVitals) : [], [assessedVitals]);
  useEffect(() => {
    if (!initialVisitId) return;
    const visit = visits.find(item => item.id === initialVisitId);
    if (visit) { setVitals(blankVitals()); setActive(visit); onInitialVisitOpened?.(); }
  }, [initialVisitId, visits, onInitialVisitOpened]);
  function vital(name: keyof TriageDraft, value: string) {
    setVitals((current) => ({
      ...current,
      [name]: value,
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
          chiefComplaint: f.get("chiefComplaint"),
          weightKg: f.get("weightKg"),
          heightCm: f.get("heightCm") || undefined,
          triageCategory: f.get("triageCategory"),
          pregnancyStatus: f.get("pregnancyStatus") || undefined,
          lastMenstrualPeriod: f.get("lastMenstrualPeriod") || undefined,
          notes: f.get("notes") || undefined,
        }),
      });
      await onCompleted(active.patient.fullName);
      setVitals(blankVitals());
      setActive(null);
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
                  onClick={() => { setVitals(blankVitals()); setActive(v); }}
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
          <strong>Minimum necessary triage detail</strong>
          <span>
            Ask enough to identify immediate danger and route safely. Record a
            brief presenting concern or red flag here; the clinician will take
            the detailed history in private.
          </span>
        </div>
        <label className="wide">
          Presenting concern / immediate red flag *
          <textarea name="chiefComplaint" minLength={2} maxLength={500} rows={2} required placeholder="Brief reason for triage; avoid a detailed history" />
        </label>
        <fieldset className="wide vitalGrid">
          <legend>Vital signs</legend>
          <p className="wide listHint">Enter the values you measured. No “normal” observations are prefilled.</p>
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
              required
            >
              <option value="">Select observed response</option>
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
          <select name="triageCategory" defaultValue="" required>
            <option value="">Select after assessment</option>
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
