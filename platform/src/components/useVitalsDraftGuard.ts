"use client";
import { useEffect, useRef } from "react";

/** Keep visit-specific drafts in memory and protect them from accidental navigation. */
export function useVitalsDraftGuard() {
  const dirty = useRef(false), pending = useRef(false);
  function confirmLeave() {
    if (pending.current) return false;
    return !dirty.current || window.confirm("Leave this visit and discard unsaved measurements or assessment? If a save was not confirmed, retry it before leaving.");
  }
  useEffect(() => {
    const navigate = (event: Event) => { if (!confirmLeave()) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || pending.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("mwein:before-workspace-navigation", navigate);
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("mwein:before-workspace-navigation", navigate); window.removeEventListener("beforeunload", unload); };
  }, []);
  return { dirty, pending, confirmLeave };
}
