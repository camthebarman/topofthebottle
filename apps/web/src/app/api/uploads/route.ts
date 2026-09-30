import { decodeBytes, detectDelimiter, guessColumns, parseCsv, sensitiveHeaders, suggestPresets } from "@tz/domain";
import { NextResponse } from "next/server";
import { UserError } from "@/lib/errors";
import { correlationId, log } from "@/lib/log";
import { hit } from "@/lib/rate-limit";
import { getContext } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, kick } from "@/server/jobs";
import { flagDuplicates } from "@/server/jobs/invoice";
import { storeUpload } from "@/server/uploads";

export async function POST(request: Request) {
  const cid = await correlationId();
  try {
    const app = await getContext();
    const fd = await request.formData();
    const kind = fd.get("kind");
    const file = fd.get("file");
    if (kind !== "invoice" && kind !== "pos_export") throw new UserError("Unknown upload type.");
    if (!(file instanceof File)) throw new UserError("Choose a file.");
    const perm = kind === "invoice" ? "invoices.upload" : "imports.manage";
    if (!app.can(perm)) throw new UserError("You do not have permission to upload this.", "forbidden");
    if (!hit(`upload:${app.user.id}`, 20, 60_000)) throw new UserError("Too many uploads. Wait a minute.", "limit");
    const admin = createAdminClient();
    const { data: allowed } = await admin.rpc("consume_allowance", { p_org: app.org.orgId, p_metric: "upload_bytes", p_amount: file.size });
    if (!allowed) throw new UserError("This month's upload allowance is used up.", "limit");

    const doc = await storeUpload(app, kind, file);

    if (kind === "invoice") {
      const { data: inv, error } = await app.supabase
        .from("invoices")
        .insert({ org_id: app.org.orgId, location_id: app.location.id, document_id: doc.id, status: "uploaded", created_by: app.user.id, currency: app.location.currency })
        .select("id")
        .single();
      if (error || !inv) throw new UserError("The invoice could not be created.");
      await flagDuplicates(admin, app.org.orgId, inv.id);
      await admin.from("invoices").update({ status: "extracting" }).eq("id", inv.id);
      await enqueue(app.org.orgId, "invoice_extract", { invoiceId: inv.id }, { createdBy: app.user.id, idempotencyKey: inv.id, timeoutSeconds: 180 });
      kick(["invoice_extract"]);
      return NextResponse.json({ redirect: `/inventory/invoices/${inv.id}` });
    }

    // POS export: read the header and a preview now; full validation runs as a job after mapping.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { text, encoding } = decodeBytes(bytes.subarray(0, 256 * 1024));
    const sample = text.slice(0, text.lastIndexOf("\n") > 0 ? text.lastIndexOf("\n") : text.length);
    const delimiter = detectDelimiter(sample);
    let preview: string[][];
    try {
      preview = parseCsv(sample, delimiter, { maxFieldChars: 10_000, maxColumns: 200, maxRows: 26 }).slice(0, 26);
    } catch {
      preview = parseCsv(sample.split(/\r?\n/).slice(0, 20).join("\n"), delimiter);
    }
    const headers = (preview[0] ?? []).map((h) => h.trim());
    if (headers.length < 2) throw new UserError("Could not find a header row. Check that this is a CSV export.");
    const preset = suggestPresets(headers)[0];
    const profile = preset
      ? { ...preset, delimiter }
      : { name: "Custom mapping", vendor: "generic", kind: "transactions", columns: guessColumns(headers), dateFormat: "MM/DD/YYYY", decimalSeparator: ".", verified: false, sourceNote: "Mapped by hand", delimiter };
    const { data: same } = await admin.from("documents").select("id").eq("org_id", app.org.orgId).eq("sha256", doc.sha256).neq("id", doc.id).limit(1);
    const { data: imp, error } = await admin
      .from("pos_imports")
      .insert({
        org_id: app.org.orgId,
        location_id: app.location.id,
        document_id: doc.id,
        kind: profile.kind,
        profile,
        encoding,
        delimiter,
        status: "uploaded",
        created_by: app.user.id,
        stats: {
          headers,
          // Preview is limited to mapped-safe display; sensitive columns are blanked.
          preview: preview.slice(1, 11).map((r) => r.map((c, i) => (sensitiveHeaders([headers[i] ?? ""]).length ? "•••" : c.slice(0, 80)))),
          sensitive_headers: sensitiveHeaders(headers),
          suggested_preset: preset?.id ?? null,
          file_sha256: doc.sha256,
          same_file_uploaded_before: !!same?.length,
        },
      })
      .select("id")
      .single();
    if (error || !imp) throw new UserError("The import could not be created.");
    return NextResponse.json({ redirect: `/imports/${imp.id}` });
  } catch (err) {
    if (err instanceof UserError) {
      const status = err.code === "forbidden" ? 403 : err.code === "limit" ? 429 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    const digest = (err as { digest?: string }).digest;
    if (digest?.startsWith("NEXT_REDIRECT")) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    log("error", "upload.failed", { correlationId: cid, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Upload failed. Nothing was saved. Try again." }, { status: 500 });
  }
}
