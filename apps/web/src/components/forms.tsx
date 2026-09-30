"use client";

import { type ReactNode, useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx } from "@/components/ui";

import type { ActionState } from "@/lib/action-state";
export type { ActionState };

type ActionFn<T> = (state: ActionState<T>, fd: FormData) => Promise<ActionState<T>>;

export function SubmitButton({ children, variant = "primary", pendingText = "Saving…", className }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, className)}>
      {pending ? pendingText : children}
    </button>
  );
}

/**
 * A form bound to a server action. Shows pending, saved and error states, and
 * an "unsaved changes" marker once the user edits a field. Nothing is shown
 * as saved until the server confirms it.
 */
export function ActionForm<T>({
  action,
  children,
  className,
  resetOnSuccess = false,
  successMessage = "Saved",
  onSuccess,
  id,
}: {
  action: ActionFn<T>;
  children: ReactNode | ((state: ActionState<T>) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  onSuccess?: (state: ActionState<T>) => void;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState<T>, FormData>(action, { status: "idle" });
  const [dirty, setDirty] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const lastState = useRef(state);

  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.status === "success") {
      setDirty(false);
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
  }, [state, resetOnSuccess, onSuccess]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <form ref={ref} id={id} action={formAction} onChange={() => setDirty(true)} className={cx("space-y-4", className)} noValidate>
      {typeof children === "function" ? children(state) : children}
      <div aria-live="polite" className="min-h-5 text-sm">
        {pending ? <span className="text-muted">Saving…</span> : null}
        {!pending && state.status === "error" ? (
          <span role="alert" className="font-medium text-danger">
            {state.message}
          </span>
        ) : null}
        {!pending && state.status === "success" && !dirty ? <span className="font-medium text-ok">{state.message ?? successMessage}</span> : null}
        {!pending && dirty ? <span className="text-warn">Unsaved changes</span> : null}
      </div>
    </form>
  );
}

export function fieldErrors(state: ActionState, name: string): string[] | undefined {
  return state.status === "error" ? state.fieldErrors?.[name] : undefined;
}

/** Button that asks for confirmation before submitting its form. */
export function ConfirmSubmit({ children, message, variant = "danger" }: { children: ReactNode; message: string; variant?: "primary" | "danger" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant)}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
