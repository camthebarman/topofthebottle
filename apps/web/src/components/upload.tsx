"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui";

/** File upload with an explicit in-progress, error and done state. Camera capture on phones for invoices. */
export function UploadForm({ kind, label, accept, camera }: { kind: "invoice" | "pos_export"; label: string; accept: string; camera?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: "idle" | "uploading" | "error"; message?: string }>({ status: "idle" });
  const [file, setFile] = useState<File | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setState({ status: "error", message: "Choose a file first." });
    if (file.size > 25 * 1024 * 1024) return setState({ status: "error", message: "Files must be 25 MB or smaller." });
    setState({ status: "uploading" });
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    try {
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (!res.ok || !json.redirect) return setState({ status: "error", message: json.error ?? "Upload failed. Nothing was saved." });
      router.push(json.redirect);
    } catch {
      setState({ status: "error", message: "Could not reach the server. Check your connection; nothing was saved." });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label htmlFor={`file-${kind}`} className="block text-sm font-medium">{label}</label>
        <input id={`file-${kind}`} type="file" accept={accept} onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} className="mt-1 block w-full min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-surface-2 file:px-4 file:font-medium" />
      </div>
      {camera ? (
        <div>
          <label htmlFor={`cam-${kind}`} className={buttonClass("secondary", "w-full cursor-pointer sm:w-auto")}>Take a photo</label>
          <input id={`cam-${kind}`} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
          {file ? <p className="mt-1 text-sm text-muted">Selected: {file.name}</p> : null}
        </div>
      ) : null}
      <button type="submit" disabled={state.status === "uploading"} className={buttonClass("primary")}>
        {state.status === "uploading" ? "Uploading…" : "Upload"}
      </button>
      <div aria-live="polite" className="min-h-5 text-sm">
        {state.status === "error" ? <span role="alert" className="font-medium text-danger">{state.message}</span> : null}
      </div>
    </form>
  );
}
