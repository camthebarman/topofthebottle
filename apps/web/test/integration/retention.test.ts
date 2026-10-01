import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, ANON, demoIds, localEnv, URL_ } from "./setup";

// runRetention reads its configuration from process.env, like the job runner does.
Object.assign(process.env, localEnv());

/** A throwaway tenant created through the normal path (create_organization as its owner). */
async function tenant(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}.${randomUUID().slice(0, 8)}@example.test`;
  const { data: u, error } = await admin().auth.admin.createUser({ email, password: "throwaway-password-1", email_confirm: true });
  if (error) throw error;
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  await c.auth.signInWithPassword({ email, password: "throwaway-password-1" });
  const { data: org, error: e2 } = await c.rpc("create_organization", { p_name: name, p_location_name: "Bar", p_timezone: "UTC", p_display_name: "Owner" });
  if (e2) throw e2;
  const loc = (await admin().from("locations").select("id").eq("org_id", org).single()).data!.id as string;
  return { org: org as string, loc, userId: u.user.id };
}

async function storeDoc(org: string, loc: string, retainUntil: string) {
  const id = randomUUID();
  const path = `org/${org}/invoice/${id}.pdf`;
  const body = Buffer.from(`%PDF-1.4 test ${id}`);
  const up = await admin().storage.from("documents").upload(path, body, { contentType: "application/pdf" });
  if (up.error) throw up.error;
  const { error } = await admin().from("documents").insert({ id, org_id: org, location_id: loc, kind: "invoice", storage_path: path, filename: "inv.pdf", mime_type: "application/pdf", size_bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), retain_until: retainUntil });
  if (error) throw error;
  return { id, path };
}

async function fileExists(path: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const { data } = await admin().storage.from("documents").list(dir);
  return (data ?? []).some((o) => `${dir}/${o.name}` === path);
}

describe("retention and organization deletion", () => {
  let runRetention: () => Promise<{ documents: number; organizations: number }>;
  beforeAll(async () => {
    ({ runRetention } = await import("@/server/retention"));
  });

  it("deletes expired documents and their files, keeps current ones, and audits it", async () => {
    const t = await tenant("Retention Bar");
    const expired = await storeDoc(t.org, t.loc, "2020-01-01");
    const current = await storeDoc(t.org, t.loc, "2099-01-01");
    await runRetention();
    const docs = (await admin().from("documents").select("id, deleted_at").eq("org_id", t.org)).data!;
    expect(docs.find((d) => d.id === expired.id)?.deleted_at).not.toBeNull();
    expect(docs.find((d) => d.id === current.id)?.deleted_at).toBeNull();
    expect(await fileExists(expired.path)).toBe(false);
    expect(await fileExists(current.path)).toBe(true);
    const audit = await admin().from("audit_events").select("id").eq("org_id", t.org).eq("action", "document.retention_deleted").eq("entity_id", expired.id);
    expect(audit.data).toHaveLength(1);
  });

  it("deletes an organization only after its scheduled date, including its files, and nothing else", async () => {
    const ids = await demoIds();
    const demoProducts = (await admin().from("products").select("id", { count: "exact", head: true }).eq("org_id", ids.org)).count;
    const due = await tenant("Closing Bar");
    const later = await tenant("Not Yet Bar");
    const dueDoc = await storeDoc(due.org, due.loc, "2099-01-01");
    await admin().from("products").insert({ org_id: due.org, name: "Gin", category: "spirit", dimension: "volume" });
    await admin().from("data_requests").insert([
      { org_id: due.org, kind: "delete_organization", requested_by: due.userId, scheduled_for: new Date(Date.now() - 60_000).toISOString() },
      { org_id: later.org, kind: "delete_organization", requested_by: later.userId, scheduled_for: new Date(Date.now() + 29 * 86_400_000).toISOString() },
    ]);

    const r = await runRetention();
    expect(r.organizations).toBeGreaterThanOrEqual(1);
    expect((await admin().from("organizations").select("id").eq("id", due.org)).data).toHaveLength(0);
    expect((await admin().from("products").select("id").eq("org_id", due.org)).data).toHaveLength(0);
    expect((await admin().from("documents").select("id").eq("org_id", due.org)).data).toHaveLength(0);
    expect(await fileExists(dueDoc.path)).toBe(false);

    expect((await admin().from("organizations").select("id").eq("id", later.org)).data).toHaveLength(1);
    expect((await admin().from("products").select("id", { count: "exact", head: true }).eq("org_id", ids.org)).count).toBe(demoProducts);
  });
});
