import "server-only";
import { log } from "@/lib/log";
import { type AdminClient, createAdminClient } from "@/lib/supabase/admin";

async function removeStoragePrefix(admin: AdminClient, prefix: string): Promise<number> {
  let removed = 0;
  // Storage lists one folder level at a time.
  const walk = async (path: string): Promise<void> => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await admin.storage.from("documents").list(path, { limit: 100, offset });
      if (error) throw new Error(error.message);
      if (!data?.length) return;
      const files = data.filter((o) => o.id).map((o) => `${path}/${o.name}`);
      const folders = data.filter((o) => !o.id).map((o) => `${path}/${o.name}`);
      if (files.length) {
        const r = await admin.storage.from("documents").remove(files);
        if (r.error) throw new Error(r.error.message);
        removed += files.length;
      }
      for (const f of folders) await walk(f);
      if (data.length < 100) return;
    }
  };
  await walk(prefix);
  return removed;
}

/**
 * Applies the documented retention policy and executes organization deletions
 * whose 30-day cooling-off period has passed. Idempotent; safe to run often.
 */
export async function runRetention(): Promise<{ documents: number; organizations: number }> {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  let documents = 0;
  const { data: expired } = await admin.from("documents").select("id, org_id, storage_path").lt("retain_until", today).is("deleted_at", null).limit(500);
  for (const d of expired ?? []) {
    const r = await admin.storage.from("documents").remove([d.storage_path]);
    if (r.error) {
      log("error", "retention.document_failed", { documentId: d.id, error: r.error.message });
      continue;
    }
    await admin.from("documents").update({ deleted_at: new Date().toISOString() }).eq("id", d.id);
    await admin.from("audit_events").insert({ org_id: d.org_id, action: "document.retention_deleted", entity_type: "document", entity_id: d.id, data: {} });
    documents++;
  }
  let organizations = 0;
  const { data: due } = await admin.from("data_requests").select("id, org_id").eq("kind", "delete_organization").eq("status", "requested").lte("scheduled_for", new Date().toISOString()).limit(20);
  for (const r of due ?? []) {
    try {
      await admin.from("data_requests").update({ status: "processing" }).eq("id", r.id);
      const files = await removeStoragePrefix(admin, `org/${r.org_id}`);
      const { error } = await admin.from("organizations").delete().eq("id", r.org_id); // cascades to all tenant rows
      if (error) throw new Error(error.message);
      // The request row is deleted with the organization; the structured log is the record.
      log("info", "retention.organization_deleted", { orgId: r.org_id, requestId: r.id, files });
      organizations++;
    } catch (e) {
      await admin.from("data_requests").update({ status: "failed" }).eq("id", r.id);
      log("error", "retention.organization_failed", { orgId: r.org_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { documents, organizations };
}
