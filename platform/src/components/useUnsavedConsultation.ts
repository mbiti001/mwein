"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const navigationEvent = "mwein:before-workspace-navigation";

// Called before any navigation state changes or logout request.
export function confirmWorkspaceNavigation() {
  return window.dispatchEvent(new Event(navigationEvent, { cancelable: true }));
}

const labels: Record<string, string> = {
  notes: "clinical notes and plan", diagnosis: "diagnosis", investigations: "investigation requests",
  prescription: "prescription", problem: "active problem", completion: "closure instruction",
};
type Snapshot = Record<string, string>;

export function useUnsavedConsultation(problem: string, pending: boolean) {
  const form = useRef<HTMLFormElement>(null);
  const baseline = useRef<Snapshot | null>(null);
  const resetGroups = useRef<string[]>([]);
  const currentProblem = useRef(problem);
  const busy = useRef(pending);
  const [unsaved, setUnsaved] = useState<string[]>([]);

  function snapshot(): Snapshot {
    const groups: Record<string, unknown[]> = {};
    form.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea").forEach(control => {
      // Search text is not an order; selected picker values have named hidden inputs.
      if (!control.name && control.closest(".searchablePicker,.searchableMulti")) return;
      const group = control.name === "cancelPendingOrders" ? "completion" : control.closest<HTMLElement>("[data-unsaved-group]")?.dataset.unsavedGroup;
      if (!group) return;
      const value = control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type) ? control.checked : control.value;
      (groups[group] ||= []).push([control.name, value]);
    });
    return { ...Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, JSON.stringify(value)])), problem: currentProblem.current };
  }
  function changed() {
    const current = snapshot();
    return baseline.current ? Object.keys(current).filter(key => current[key] !== baseline.current![key]) : [];
  }
  function refresh() {
    const next = changed();
    setUnsaved(previous => previous.join() === next.join() ? previous : next);
  }
  useLayoutEffect(() => {
    currentProblem.current = problem;
    busy.current = pending;
    baseline.current ||= snapshot();
    for (const group of resetGroups.current) baseline.current[group] = snapshot()[group];
    resetGroups.current = [];
    refresh();
  });
  useEffect(() => {
    const element = form.current;
    const observer = new MutationObserver(refresh);
    if (element) observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "checked"] });
    const guard = (event: Event) => {
      const dirty = changed();
      if (!dirty.length && !busy.current) return;
      const message = busy.current
        ? "A consultation request is still in progress. Leaving does not cancel it, and its result may need checking before you retry. Leave this consultation?"
        : `Unsaved ${dirty.map(key => labels[key]).join(", ")}. Leave and discard these changes? Cancel to stay and save each section.`;
      if (!window.confirm(message)) event.preventDefault();
    };
    window.addEventListener(navigationEvent, guard);
    return () => {
      observer.disconnect();
      window.removeEventListener(navigationEvent, guard);
    };
  }, []); // The listeners read current DOM values and refs, never an earlier render.
  useEffect(() => {
    if (!unsaved.length && !pending) return;
    const guard = (event: BeforeUnloadEvent) => {
      if (!changed().length && !busy.current) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unsaved, pending]);

  return {
    form, snapshot, changed, refresh,
    description: unsaved.map(key => labels[key]).join(", "),
    markSaved(group: string, submitted: Snapshot) {
      if (baseline.current) baseline.current[group] = submitted[group];
      refresh();
    },
    resetAfterRender(group: string) { resetGroups.current.push(group); },
  };
}
