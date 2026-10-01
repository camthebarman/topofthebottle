import { isDemo } from "@/lib/demo";

/** Shown on every page in demo mode. */
export function DemoBanner() {
  if (!isDemo()) return null;
  return (
    <p role="note" className="mb-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm print:hidden">
      <strong>Demo.</strong> Everyone shares these accounts and sees each other&apos;s changes. All data is invented and is reset every night. Don&apos;t enter real information.
    </p>
  );
}
