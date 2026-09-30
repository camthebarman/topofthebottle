import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "bg-surface text-fg border border-border hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "text-fg hover:bg-surface-2",
};

export const buttonClass = (variant: Variant = "primary", extra?: string) =>
  cx(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
    variants[variant],
    extra,
  );

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

export function LinkButton({ variant = "secondary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, children, className, actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-border bg-surface p-4", className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

type Tone = "info" | "ok" | "warn" | "danger" | "neutral";
const toneClass: Record<Tone, string> = {
  info: "border-info/40 bg-info/10 text-fg",
  ok: "border-ok/40 bg-ok/10 text-fg",
  warn: "border-warn/50 bg-warn/10 text-fg",
  danger: "border-danger/50 bg-danger/10 text-fg",
  neutral: "border-border bg-surface-2 text-fg",
};

export function Notice({ tone = "info", title, children, role }: { tone?: Tone; title?: string; children?: ReactNode; role?: "status" | "alert" }) {
  return (
    <div role={role} className={cx("rounded-lg border p-3 text-sm", toneClass[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : ""}>{children}</div> : null}
    </div>
  );
}

const badgeTone: Record<Tone, string> = {
  info: "bg-info/15 text-info",
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  neutral: "bg-surface-2 text-muted",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", badgeTone[tone])}>{children}</span>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cx("tabular mt-1 text-xl font-semibold", tone === "danger" && "text-danger", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  "block w-full min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-muted aria-[invalid=true]:border-danger";

interface FieldBase {
  label: string;
  name: string;
  hint?: ReactNode;
  errors?: string[];
}

function FieldShell({ label, name, hint, errors, children }: FieldBase & { children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p id={`${name}-hint`} className="text-xs text-muted">{hint}</p> : null}
      {errors?.length ? (
        <p id={`${name}-error`} className="text-sm text-danger">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(name: string, hint?: ReactNode, errors?: string[]) {
  return [hint ? `${name}-hint` : null, errors?.length ? `${name}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function Field({ label, name, hint, errors, className, ...props }: FieldBase & Omit<ComponentProps<"input">, "name">) {
  return (
    <FieldShell label={label} name={name} hint={hint} errors={errors}>
      <input id={name} name={name} aria-invalid={errors?.length ? true : undefined} aria-describedby={describedBy(name, hint, errors)} className={cx(inputClass, className)} {...props} />
    </FieldShell>
  );
}

export function TextArea({ label, name, hint, errors, className, ...props }: FieldBase & Omit<ComponentProps<"textarea">, "name">) {
  return (
    <FieldShell label={label} name={name} hint={hint} errors={errors}>
      <textarea id={name} name={name} aria-invalid={errors?.length ? true : undefined} aria-describedby={describedBy(name, hint, errors)} className={cx(inputClass, "min-h-24", className)} {...props} />
    </FieldShell>
  );
}

export function Select({ label, name, hint, errors, className, children, ...props }: FieldBase & Omit<ComponentProps<"select">, "name">) {
  return (
    <FieldShell label={label} name={name} hint={hint} errors={errors}>
      <select id={name} name={name} aria-invalid={errors?.length ? true : undefined} aria-describedby={describedBy(name, hint, errors)} className={cx(inputClass, className)} {...props}>
        {children}
      </select>
    </FieldShell>
  );
}

export function Checkbox({ label, name, hint, ...props }: { label: string; name: string; hint?: ReactNode } & Omit<ComponentProps<"input">, "name" | "type">) {
  return (
    <div className="flex items-start gap-3">
      <input id={name} name={name} type="checkbox" className="mt-1 size-5 accent-[var(--accent)]" aria-describedby={hint ? `${name}-hint` : undefined} {...props} />
      <div>
        <label htmlFor={name} className="text-sm font-medium">
          {label}
        </label>
        {hint ? <p id={`${name}-hint`} className="text-xs text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Rows that become cards on narrow screens: label/value pairs stack. */
export function DataList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="flex justify-between gap-3 border-b border-border py-1.5 sm:block sm:border-0">
          <dt className="text-sm text-muted">{i.label}</dt>
          <dd className="tabular text-right font-medium sm:text-left">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ListLink({ href, title, meta, right }: { href: string; title: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-surface-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          {meta ? <p className="truncate text-sm text-muted">{meta}</p> : null}
        </div>
        {right ? <div className="shrink-0 text-right">{right}</div> : null}
      </Link>
    </li>
  );
}

export function Pagination({ page, hasMore, makeHref }: { page: number; hasMore: boolean; makeHref: (p: number) => string }) {
  if (page <= 1 && !hasMore) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex justify-between">
      {page > 1 ? <LinkButton href={makeHref(page - 1)}>Previous</LinkButton> : <span />}
      {hasMore ? <LinkButton href={makeHref(page + 1)}>Next</LinkButton> : <span />}
    </nav>
  );
}
