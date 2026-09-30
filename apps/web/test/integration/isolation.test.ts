import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, as, demoIds } from "./setup";

let ids: Awaited<ReturnType<typeof demoIds>>;
beforeAll(async () => {
  ids = await demoIds();
});

describe("cross-tenant access through the API", () => {
  it("another organization's owner cannot read rows by guessed id", async () => {
    const other = await as("other-org@demo.test");
    const r1 = await other.from("products").select("id").eq("id", ids.product);
    expect(r1.data).toEqual([]);
    const r2 = await other.from("locations").select("id").eq("id", ids.loc);
    expect(r2.data).toEqual([]);
    const r3 = await other.from("product_costs").select("id").eq("org_id", ids.org);
    expect(r3.data).toEqual([]);
  });

  it("nested selects do not leak through relationships", async () => {
    const other = await as("other-org@demo.test");
    const { data, error } = await other.from("recipe_components").select("id, recipe_versions(recipe_id, recipes!recipe_versions_org_id_recipe_id_fkey(name))").eq("org_id", ids.org);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const member = await (await as("owner@demo.test")).from("recipe_components").select("id, recipe_versions(recipe_id)").eq("org_id", ids.org).limit(1);
    expect(member.data?.length).toBe(1); // the query itself works for a member
    const own = await other.from("memberships").select("user_id, organizations(name)");
    expect(own.data?.every((m) => (m.organizations as unknown as { name: string }).name === "Unrelated Tavern")).toBe(true);
  });

  it("cannot write into another organization", async () => {
    const other = await as("other-org@demo.test");
    const ins = await other.from("products").insert({ org_id: ids.org, name: "Injected", dimension: "volume" });
    expect(ins.error?.code).toBe("42501");
    const upd = await other.from("products").update({ name: "Hijacked" }).eq("id", ids.product).select("id");
    expect(upd.data).toEqual([]);
    const rpc = await other.rpc("record_movement", { p_org: ids.org, p_location: ids.loc, p_product: ids.product, p_type: "waste", p_qty_base: -10, p_occurred_at: new Date().toISOString(), p_reason: "x" });
    expect(rpc.error?.code).toBe("42501");
    const inv = await other.rpc("create_invitation", { p_org: ids.org, p_email: "x@example.test", p_role: "owner" });
    expect(inv.error?.code).toBe("42501");
    // A row in your own org cannot reference another org's product.
    const cross = await other.from("location_products").insert({ org_id: ids.other, location_id: ids.otherLoc, product_id: ids.product, par_base: 1 });
    expect(cross.error).not.toBeNull();
  });

  it("anonymous requests see nothing and cannot call functions", async () => {
    const a = anon();
    for (const t of ["organizations", "products", "sales_lines", "audit_events", "jobs", "invoices"]) {
      const r = await a.from(t).select("*").limit(1);
      expect(r.data ?? []).toEqual([]);
    }
    const r = await a.rpc("my_permissions", { p_org: ids.org });
    expect(r.error).not.toBeNull();
  });

  it("jobs cannot be created or claimed by users", async () => {
    const owner = await as("owner@demo.test");
    const ins = await owner.from("jobs").insert({ org_id: ids.org, kind: "invoice_extract", payload: {} });
    expect(ins.error?.code).toBe("42501");
    const claim = await owner.rpc("claim_job", { p_worker: "x", p_kinds: ["invoice_extract"] });
    expect(claim.error).not.toBeNull();
    const allowance = await owner.rpc("consume_allowance", { p_org: ids.org, p_metric: "ai_explanation", p_amount: -1000 });
    expect(allowance.error).not.toBeNull();
  });

  it("jobs of one tenant are invisible to another", async () => {
    const { data: job } = await admin().from("jobs").insert({ org_id: ids.org, kind: "retention_sweep", payload: {}, status: "cancelled" }).select("id").single();
    const other = await as("other-org@demo.test");
    const r = await other.from("jobs").select("id").eq("id", job!.id);
    expect(r.data).toEqual([]);
    await admin().from("jobs").delete().eq("id", job!.id);
  });
});

describe("roles through the API", () => {
  it("bartenders cannot see costs or finalize counts", async () => {
    const b = await as("bartender@demo.test");
    expect((await b.from("product_costs").select("id").limit(1)).data).toEqual([]);
    const s = await b.from("count_sessions").insert({ org_id: ids.org, location_id: ids.loc }).select("id, version").single();
    expect(s.error).toBeNull();
    const fin = await b.rpc("finalize_count", { p_org: ids.org, p_session: s.data!.id, p_expected_version: s.data!.version });
    expect(fin.error?.code).toBe("42501");
  });

  it("members cannot escalate their own role or edit the audit log", async () => {
    const b = await as("bartender@demo.test");
    const { data: me } = await b.auth.getUser();
    const upd = await b.from("memberships").update({ role: "owner" }).eq("user_id", me.user!.id).select("role");
    expect(upd.error?.code ?? (upd.data?.length ? "updated" : "blocked")).not.toBe("updated");
    const rpc = await b.rpc("update_membership", { p_org: ids.org, p_user: me.user!.id, p_role: "owner", p_location_ids: null, p_status: "active" });
    expect(rpc.error?.code).toBe("42501");
    const m = await as("manager@demo.test");
    const del = await m.from("audit_events").delete().eq("org_id", ids.org);
    expect(del.error?.code).toBe("42501");
  });

  it("stale writes are rejected (optimistic concurrency)", async () => {
    const m = await as("manager@demo.test");
    const o = await as("owner@demo.test");
    const { data: p } = await m.from("products").select("id, version").eq("id", ids.product).single();
    const first = await o.from("products").update({ container_label: "bottle", version: p!.version }).eq("id", ids.product).select("version");
    expect(first.error).toBeNull();
    const second = await m.from("products").update({ container_label: "btl", version: p!.version }).eq("id", ids.product).select("version");
    expect(second.error?.code).toBe("40001");
  });
});

describe("private storage", () => {
  it("objects are only reachable by members with the matching permission", async () => {
    const owner = await as("owner@demo.test");
    const path = `org/${ids.org}/invoice/${crypto.randomUUID()}.pdf`;
    const up = await owner.storage.from("documents").upload(path, new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), { contentType: "application/pdf" });
    expect(up.error).toBeNull();

    const other = await as("other-org@demo.test");
    expect((await other.storage.from("documents").download(path)).error).not.toBeNull();
    expect((await other.storage.from("documents").createSignedUrl(path, 60)).error).not.toBeNull();
    const plant = await other.storage.from("documents").upload(`org/${ids.org}/invoice/${crypto.randomUUID()}.pdf`, new Blob(["%PDF-1.4"]), { contentType: "application/pdf" });
    expect(plant.error).not.toBeNull();

    // Bartenders may handle invoices but not POS exports.
    const b = await as("bartender@demo.test");
    expect((await b.storage.from("documents").download(path)).error).toBeNull();
    const pos = await b.storage.from("documents").upload(`org/${ids.org}/pos_export/${crypto.randomUUID()}.csv`, new Blob(["a,b"]), { contentType: "text/csv" });
    expect(pos.error).not.toBeNull();
    // Public URLs do not work: the bucket is private.
    const res = await fetch(owner.storage.from("documents").getPublicUrl(path).data.publicUrl);
    expect(res.status).toBeGreaterThanOrEqual(400);
    await admin().storage.from("documents").remove([path]);
  });
});
