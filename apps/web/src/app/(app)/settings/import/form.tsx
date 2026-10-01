"use client";

import { useState } from "react";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/forms";
import { applyLegacy, type PreviewData, previewLegacy } from "./actions";

function Report({ d }: { d: PreviewData }) {
  return (
    <div className="space-y-3 text-sm">
      <table className="w-full">
        <caption className="text-left font-semibold">Records found and imported</caption>
        <thead><tr><th className="text-left">Kind</th><th className="text-right">Found</th><th className="text-right">Imported</th></tr></thead>
        <tbody>{Object.entries(d.counts).map(([k, c]) => <tr key={k}><td>{k}</td><td className="text-right">{c.found}</td><td className="text-right">{c.imported}</td></tr>)}</tbody>
      </table>
      {d.exceptions.length ? (
        <div>
          <p className="font-semibold">Not imported ({d.exceptions.length})</p>
          <ul className="list-disc pl-5">{d.exceptions.map((e, i) => <li key={i}>{e.kind}{e.name ? ` “${e.name}”` : ""}: {e.reason}</li>)}</ul>
        </div>
      ) : <p className="text-ok">Everything in the file can be imported.</p>}
    </div>
  );
}

export function LegacyImport() {
  const [json, setJson] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<PreviewData | null>(null);
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="legacy-file" className="block text-sm font-medium">Export file (.json) from 86d, Don&apos;t Go Pour, Food Cost or Clayton</label>
        <input id="legacy-file" type="file" accept="application/json,.json" className="mt-1 block min-h-11 w-full text-sm" onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          setPreview(null);
          setResult(null);
          if (!f) return;
          setName(f.name);
          setJson(await f.text());
        }} />
      </div>
      {json ? (
        <ActionForm<PreviewData> action={previewLegacy} onSuccess={(s) => s.status === "success" && s.data && setPreview(s.data)}>
          <input type="hidden" name="json" value={json} />
          <SubmitButton variant="secondary" pendingText="Reading…">Preview {name}</SubmitButton>
        </ActionForm>
      ) : null}
      {preview && !result ? (
        <>
          <Report d={preview} />
          <ActionForm<PreviewData> action={applyLegacy} onSuccess={(s) => s.status === "success" && s.data && setResult(s.data)}>
            <input type="hidden" name="json" value={json} />
            <ConfirmSubmit variant="primary" message={`Import ${preview.products} products and ${preview.recipes} recipes into this location? Items listed as not imported stay only in your file.`}>Import</ConfirmSubmit>
          </ActionForm>
        </>
      ) : null}
      {result ? (
        <div role="status" className="space-y-3">
          <p className="font-semibold text-ok">Imported {result.products} products and {result.recipes} recipes.</p>
          <Report d={result} />
        </div>
      ) : null}
    </div>
  );
}
