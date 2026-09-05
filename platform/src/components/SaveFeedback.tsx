"use client";
import { useEffect } from "react";

const actionText = /^(save|create|register|record|submit|verify|complete|dispense|receive|post|publish|transfer|approve|update|add|sign|pay|reverse)/i;

export default function SaveFeedback() {
  useEffect(() => {
    let actionButton: HTMLButtonElement | null = null;
    const restore = (form: HTMLFormElement) => {
      const button = form.querySelector<HTMLButtonElement>("button[data-save-complete]");
      if (!button) return;
      button.hidden = false; delete button.dataset.saveComplete;
      form.querySelector(".inlineSaveConfirmation")?.remove();
    };
    const clicked = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (button && !button.disabled && actionText.test(button.textContent?.trim() || "")) actionButton = button;
    };
    const changed = (event: Event) => { const form = (event.target as HTMLElement).closest<HTMLFormElement>("form"); if (form) restore(form); };
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const notice = node.matches(".alert.success") ? node : node.querySelector<HTMLElement>(".alert.success");
        if (!notice || notice.dataset.inlineRelocated || !actionButton?.isConnected) continue;
        notice.dataset.inlineRelocated = "true";
        const confirmation = document.createElement("span"); confirmation.className = "inlineSaveConfirmation";
        confirmation.setAttribute("role", "status"); confirmation.textContent = `✓ ${notice.textContent?.trim() || "Saved successfully"}`;
        actionButton.hidden = true; actionButton.dataset.saveComplete = "true"; actionButton.insertAdjacentElement("afterend", confirmation); notice.hidden = true; actionButton = null;
      }
    });
    document.addEventListener("click", clicked, true); document.addEventListener("input", changed, true); document.addEventListener("change", changed, true);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { document.removeEventListener("click", clicked, true); document.removeEventListener("input", changed, true); document.removeEventListener("change", changed, true); observer.disconnect(); };
  }, []);
  return null;
}
