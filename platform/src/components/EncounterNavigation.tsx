"use client";
import { useRef, useState } from "react";
import { BrandMark } from "./FacilityBrand";

export const encounterSections = [
  { id: "triage", label: "Triage" },
  { id: "history", label: "Complaints & HPI" },
  { id: "background", label: "Background history" },
  { id: "examination", label: "Examination" },
  { id: "investigations", label: "Diagnostics & results" },
  { id: "prescription", label: "Prescription" },
  { id: "procedures", label: "Procedures" },
  { id: "diagnosis", label: "Final diagnosis" },
  { id: "disposition", label: "Plan & discharge" },
] as const;

export type EncounterStep = typeof encounterSections[number]["id"];
export type EncounterExitActions = { onHome?: () => void; onSignOut?: () => void };

export function EncounterNavigation({ active, onSelect, onBack, onHome, onSignOut }: EncounterExitActions & {
  active: EncounterStep; onSelect: (step: EncounterStep) => void; onBack: () => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return <div className="encounterRail noPrint" data-open={open} onKeyDown={event => {
    if (event.key === "Escape" && open) { setOpen(false); toggle.current?.focus(); }
  }}>
    <div className="encounterRailBrand"><BrandMark /><span>Mwein HMIS</span></div>
    <button className="encounterSectionsToggle" type="button" aria-label="Encounter sections" aria-expanded={open}
      aria-controls="encounter-sections-menu" ref={toggle} onClick={() => setOpen(!open)}>
      <span>Encounter sections</span><span aria-hidden="true">{open ? "Close ×" : "Choose ▴"}</span>
    </button>
    <div className="encounterRailMenu" id="encounter-sections-menu">
      <p className="encounterRailTitle">Patient encounter</p>
      <nav aria-label="Encounter sections">
        {encounterSections.map(section => <button key={section.id} type="button"
          aria-current={section.id === active ? "step" : undefined}
          aria-controls={'encounter-' + section.id}
          onClick={() => { setOpen(false); onSelect(section.id); }}>{section.label}</button>)}
      </nav>
      <div className="encounterRailExits">
        <button type="button" onClick={onBack}>← Back to queue</button>
        {onHome && <button type="button" onClick={onHome}>← Home</button>}
        {onSignOut && <button type="button" onClick={onSignOut}>Sign out</button>}
      </div>
    </div>
  </div>;
}
