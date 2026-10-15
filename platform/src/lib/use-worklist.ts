"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { jsonRequest } from "./client-http";

// A changed filter or failed refresh must never leave another result set actionable.
export function useWorklist<T>(url: string | null, refreshInterval = 0) {
  const [state, setState] = useState<{ source: string | null; data: T | null; error: string; loading: boolean; updatedAt: Date | null }>({ source: null, data: null, error: "", loading: false, updatedAt: null });
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async (keepCurrent = false) => {
    const ticket = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState(previous => ({ source: url, data: keepCurrent && previous.source === url ? previous.data : null, error: "", loading: Boolean(url), updatedAt: keepCurrent && previous.source === url ? previous.updatedAt : null }));
    if (!url) return false;
    try {
      const data = await jsonRequest<T>(url, { signal: request.signal, cache: "no-store" });
      if (ticket !== generation.current || request.signal.aborted) return false;
      setState({ source: url, data, error: "", loading: false, updatedAt: new Date() });
      return true;
    } catch (error) {
      if (ticket !== generation.current || request.signal.aborted) return false;
      setState({ source: url, data: null, error: (error as Error).message, loading: false, updatedAt: null });
      return false;
    }
  }, [url]);
  useEffect(() => {
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(true); };
    const timer = refreshInterval ? window.setInterval(visibleRefresh, refreshInterval) : undefined;
    if (refreshInterval) document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      generation.current++;
      controller.current?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh, refreshInterval]);
  return { ...(state.source === url ? state : { data: null, error: "", loading: Boolean(url), updatedAt: null }), refresh };
}
