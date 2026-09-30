"use client";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="min-h-11 rounded-lg border border-black px-4 print:hidden">Print</button>;
}
