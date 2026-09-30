"use client";

import { useEffect, useRef, useState } from "react";

const PREFIX = "tzdraft:";

/**
 * Unsent text kept in this browser tab's session storage, keyed by user and
 * organization. Nothing here has reached the server; the UI says so. Cleared
 * on sign-out and when the server confirms the save.
 */
export function useDraft(scope: string, name: string) {
  const key = `${PREFIX}${scope}:${name}`;
  const [value, setValue] = useState("");
  const [restored, setRestored] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(key);
      if (v) {
        setValue(v);
        setRestored(true);
      }
    } catch {
      /* storage unavailable: drafts are a convenience only */
    }
    loaded.current = true;
  }, [key]);
  const update = (v: string) => {
    setValue(v);
    try {
      if (v) sessionStorage.setItem(key, v);
      else sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  const clear = () => update("");
  return { value, update, clear, restored };
}

export function clearAllDrafts(): void {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
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
  }, [scope, names]);
  return null;
}
