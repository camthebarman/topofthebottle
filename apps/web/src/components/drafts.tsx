"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const PREFIX = "tzdraft:";

/**
 * Unsent text kept in this browser tab's session storage, keyed by user and
 * organization. Nothing here has reached the server; the UI says so. Cleared
 * on sign-out and when the server confirms the save.
 */
const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function read(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return ""; // storage unavailable: drafts are a convenience only
  }
}

export function useDraft(scope: string, name: string) {
  const key = `${PREFIX}${scope}:${name}`;
  const value = useSyncExternalStore(subscribe, () => read(key), () => "");
  // Text present before the person typed anything in this view is a restored draft.
  const [touched, setTouched] = useState(false);
  const update = (v: string) => {
    setTouched(true);
    try {
      if (v) sessionStorage.setItem(key, v);
      else sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    notify();
  };
  return { value, update, clear: () => update(""), restored: !touched && value !== "" };
}

export function clearAllDrafts(): void {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  notify();
}

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={() => clearAllDrafts()}>
      <button type="submit" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-surface-2">Sign out</button>
    </form>
  );
}

/** Rendered only after the server confirmed a save: removes the matching drafts. */
export function ClearDrafts({ scope, names }: { scope: string; names: string[] }) {
  useEffect(() => {
    try {
      for (const n of names) sessionStorage.removeItem(`${PREFIX}${scope}:${n}`);
    } catch {
      /* ignore */
    }
    notify();
  }, [scope, names]);
  return null;
}
