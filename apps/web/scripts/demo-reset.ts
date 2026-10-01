/**
 * Rebuilds the public demo: deletes the previous demo organization and accounts, then creates
 * "Lantern & Lime", a cocktail bar with five weeks of invented history, through the same
 * database functions and job pipeline the app uses.
 *
 * Only touches accounts on DEMO_DOMAIN and organizations whose every member is on that domain.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD
 * Run:  pnpm --filter web demo:reset
 */
import { createHash, randomUUID } from "node:crypto";
import { addDays, businessDate, explodeServings, localToUtc, PRESETS } from "@tz/domain";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO_ACCOUNTS } from "../src/lib/demo";
import type { AppContext } from "../src/lib/session";
import { loadCatalog } from "../src/server/catalog";
import { enqueue, runJobs } from "../src/server/jobs";

const DEMO_DOMAIN = "@demo.tablezero.test";
const TZ = "America/Chicago";
const ORG = "Lantern & Lime";
const URL_ = need("NEXT_PUBLIC_SUPABASE_URL");
const ANON = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = need("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = need("DEMO_PASSWORD");
if (PASSWORD.length < 10) fail("DEMO_PASSWORD must be at least 10 characters");

function need(k: string): string {
  const v = process.env[k];
  if (!v) fail(`Missing ${k}`);
  return v!;
}
function fail(msg: string): never {
  console.error(`demo-reset: ${msg}`);
  process.exit(1);
}
const log = (msg: string) => console.log(`demo-reset: ${msg}`);
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) fail(`${what}: ${error.message}`);
  return data as NonNullable<T>;
}

// Deterministic randomness so every night looks alike (dates move, patterns don't).
let seed = 20261001;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

// ---------------------------------------------------------------- 1. remove the previous demo

async function removePreviousDemo() {
  const users: { id: string; email: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`list users: ${error.message}`);
    users.push(...data.users.filter((u) => u.email?.endsWith(DEMO_DOMAIN)).map((u) => ({ id: u.id, email: u.email! })));
    if (data.users.length < 1000) break;
  }
  const ids = new Set(users.map((u) => u.id));
  const orgIds = new Set((await ok(admin.from("memberships").select("org_id").in("user_id", [...ids, "00000000-0000-0000-0000-000000000000"]), "memberships")).map((m) => m.org_id as string));
  for (const orgId of orgIds) {
    const members = await ok(admin.from("memberships").select("user_id").eq("org_id", orgId), "org members");
    if (!members.every((m) => ids.has(m.user_id as string))) {
      log(`skipping organization ${orgId}: it has members outside the demo`);
      continue;
    }
    await removeStorage(`org/${orgId}`);
    await ok(admin.from("organizations").delete().eq("id", orgId), "delete organization");
  }
  for (const u of users) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) fail(`delete user ${u.email}: ${error.message}`);
  }
  log(`removed ${orgIds.size} organization(s) and ${users.length} account(s)`);
}

async function removeStorage(prefix: string) {
  const { data } = await admin.storage.from("documents").list(prefix, { limit: 1000 });
  for (const o of data ?? []) {
    const path = `${prefix}/${o.name}`;
    if (o.id) await admin.storage.from("documents").remove([path]);
    else await removeStorage(path);
  }
}

// ---------------------------------------------------------------- 2. people

const PEOPLE = [
  { key: "owner", name: "Olivia Park", role: "owner" },
  { key: "manager", name: "Marcus Bell", role: "manager" },
  { key: "bartender", name: "Bea Alvarez", role: "bartender" },
  { key: "viewer", name: "Victor Lindqvist", role: "read_only" },
] as const;
type Key = (typeof PEOPLE)[number]["key"];

async function createPeople() {
  const ids = {} as Record<Key, string>;
  const clients = {} as Record<Key, SupabaseClient>;
  for (const p of PEOPLE) {
    const email = DEMO_ACCOUNTS.find((a) => a.email.startsWith(`${p.key}@`))!.email;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { demo: true } });
    if (error) fail(`create ${email}: ${error.message}`);
    ids[p.key] = data.user.id;
    const c = createClient(URL_, ANON, opts);
    const s = await c.auth.signInWithPassword({ email, password: PASSWORD });
    if (s.error) fail(`sign in ${email}: ${s.error.message}`);
    clients[p.key] = c;
  }
  return { ids, clients };
}

// ---------------------------------------------------------------- 3. catalog

interface ProductSpec {
  name: string; category: string; dimension: "volume" | "mass" | "count"; size: number | null; label: string | null;
  cpb: number; method: "tenths" | "measured" | "full_units"; ingredients: string[]; drift: number; supplier: "spirits" | "produce";
}
// cpb = cost per base unit (mL, g or each). drift = actual use relative to recipe spec.
const PRODUCTS: ProductSpec[] = [
  { name: "London Dry Gin", category: "spirit", dimension: "volume", size: 1000, label: "bottle", cpb: 0.024, method: "tenths", ingredients: ["London dry gin"], drift: 1.07, supplier: "spirits" },
  { name: "Bourbon", category: "spirit", dimension: "volume", size: 1000, label: "bottle", cpb: 0.028, method: "tenths", ingredients: ["Bourbon or rye whiskey", "Bourbon whiskey"], drift: 1.02, supplier: "spirits" },
  { name: "Rye Whiskey", category: "spirit", dimension: "volume", size: 750, label: "bottle", cpb: 0.04, method: "tenths", ingredients: ["Rye whiskey"], drift: 1.0, supplier: "spirits" },
  { name: "Blanco Tequila", category: "spirit", dimension: "volume", size: 1000, label: "bottle", cpb: 0.03, method: "tenths", ingredients: ["Blanco tequila"], drift: 1.01, supplier: "spirits" },
  { name: "Light Rum", category: "spirit", dimension: "volume", size: 1000, label: "bottle", cpb: 0.018, method: "tenths", ingredients: ["Light rum"], drift: 1.0, supplier: "spirits" },
  { name: "Campari", category: "liqueur", dimension: "volume", size: 1000, label: "bottle", cpb: 0.032, method: "tenths", ingredients: ["Campari", "Bitter aperitivo"], drift: 1.0, supplier: "spirits" },
  { name: "Sweet Vermouth", category: "liqueur", dimension: "volume", size: 1000, label: "bottle", cpb: 0.019, method: "tenths", ingredients: ["Sweet vermouth"], drift: 0.99, supplier: "spirits" },
  { name: "Dry Vermouth", category: "liqueur", dimension: "volume", size: 750, label: "bottle", cpb: 0.021, method: "tenths", ingredients: ["Dry vermouth"], drift: 1.0, supplier: "spirits" },
  { name: "Orange Liqueur", category: "liqueur", dimension: "volume", size: 750, label: "bottle", cpb: 0.034, method: "tenths", ingredients: ["Orange liqueur"], drift: 1.01, supplier: "spirits" },
  { name: "Prosecco", category: "wine", dimension: "volume", size: 750, label: "bottle", cpb: 0.016, method: "tenths", ingredients: ["Sparkling wine"], drift: 1.03, supplier: "spirits" },
  { name: "Aromatic Bitters", category: "mixer", dimension: "volume", size: 200, label: "bottle", cpb: 0.13, method: "measured", ingredients: ["Aromatic bitters"], drift: 1.0, supplier: "spirits" },
  { name: "Orange Bitters", category: "mixer", dimension: "volume", size: 150, label: "bottle", cpb: 0.15, method: "measured", ingredients: ["Orange bitters"], drift: 1.0, supplier: "spirits" },
  { name: "Grapefruit Soda", category: "mixer", dimension: "volume", size: 355, label: "can", cpb: 0.0045, method: "full_units", ingredients: ["Grapefruit soda"], drift: 1.0, supplier: "spirits" },
  { name: "Soda Water", category: "mixer", dimension: "volume", size: 1000, label: "bottle", cpb: 0.0015, method: "tenths", ingredients: ["Soda water"], drift: 1.0, supplier: "spirits" },
  { name: "Fresh Lime Juice", category: "juice", dimension: "volume", size: 946, label: "quart", cpb: 0.012, method: "measured", ingredients: ["Lime juice"], drift: 1.15, supplier: "produce" },
  { name: "Fresh Lemon Juice", category: "juice", dimension: "volume", size: 946, label: "quart", cpb: 0.011, method: "measured", ingredients: ["Lemon juice"], drift: 1.04, supplier: "produce" },
  { name: "Simple Syrup (house)", category: "syrup", dimension: "volume", size: 1000, label: "bottle", cpb: 0.0012, method: "measured", ingredients: ["Simple syrup"], drift: 1.02, supplier: "produce" },
  { name: "Egg Whites", category: "food", dimension: "volume", size: 946, label: "carton", cpb: 0.008, method: "measured", ingredients: ["Egg white"], drift: 1.0, supplier: "produce" },
  { name: "Oranges", category: "garnish", dimension: "count", size: null, label: null, cpb: 0.55, method: "measured", ingredients: ["Orange"], drift: 1.05, supplier: "produce" },
  { name: "Mint", category: "garnish", dimension: "count", size: null, label: null, cpb: 0.02, method: "measured", ingredients: ["Mint leaves"], drift: 1.1, supplier: "produce" },
  { name: "Cocktail Cherries", category: "garnish", dimension: "count", size: 50, label: "jar", cpb: 0.35, method: "measured", ingredients: ["Cocktail cherry"], drift: 1.0, supplier: "produce" },
  { name: "Draft Lager (keg)", category: "beer", dimension: "volume", size: 58674, label: "keg", cpb: 0.0024, method: "measured", ingredients: [], drift: 1.06, supplier: "spirits" },
  { name: "House Red", category: "wine", dimension: "volume", size: 750, label: "bottle", cpb: 0.013, method: "tenths", ingredients: [], drift: 1.02, supplier: "spirits" },
  { name: "Granulated Sugar", category: "food", dimension: "mass", size: 1814, label: "bag", cpb: 0.0011, method: "measured", ingredients: ["Granulated sugar"], drift: 1.0, supplier: "produce" },
];

const MENU = [
  { id: "NEG", name: "Negroni", tpl: "negroni", price: 14, base: 14 },
  { id: "MARG", name: "Margarita", tpl: "margarita", price: 13, base: 18 },
  { id: "DAIQ", name: "Daiquiri", tpl: "daiquiri", price: 12, base: 9 },
  { id: "OLDF", name: "Old Fashioned", tpl: "old-fashioned", price: 14, base: 12 },
  { id: "MART", name: "Martini", tpl: "martini", price: 15, base: 10 },
  { id: "WSOUR", name: "Whiskey Sour", tpl: "whiskey-sour", price: 13, base: 8 },
  { id: "MOJ", name: "Mojito", tpl: "mojito", price: 13, base: 9 },
  { id: "PAL", name: "Paloma", tpl: "paloma", price: 12, base: 10 },
  { id: "SPR", name: "Spritz", tpl: "spritz", price: 12, base: 11 },
  { id: "MANH", name: "Manhattan", tpl: "manhattan", price: 15, base: 6 },
  { id: "LAGER", name: "Draft Lager", tpl: null, price: 7, base: 20, custom: { product: "Draft Lager (keg)", ml: 473, category: "Beer" } },
  { id: "RED", name: "House Red (glass)", tpl: null, price: 11, base: 8, custom: { product: "House Red", ml: 150, category: "Wine" } },
  // Sold but never set up as a recipe: visitors can map it on the Imports page.
  { id: "SEAS", name: "Seasonal Special", tpl: null, price: 14, base: 1.5 },
] as { id: string; name: string; tpl: string | null; price: number; base: number; custom?: { product: string; ml: number; category: string } }[];
const WEEKDAY = [0.9, 0.6, 0.7, 0.8, 1.0, 1.6, 1.8]; // Sun..Sat
const SERVERS = ["Jordan R.", "Priya N.", "Bea A.", "Sam O."];

// ---------------------------------------------------------------- helpers

/** Local wall-clock time on a date in the bar's zone, as UTC. */
const at = (date: string, hhmm: string) => localToUtc(date, hhmm, TZ);
const usDate = (date: string) => {
  const [y, m, dd] = date.split("-").map(Number);
  return `${m}/${dd}/${y}`;
};
const usTime = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
};
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

// ---------------------------------------------------------------- main

async function main() {
  await removePreviousDemo();
  const { ids, clients } = await createPeople();
  const owner = clients.owner;
  const manager = clients.manager;

  // Today in the bar's zone, as seen 14 hours ago, so every timestamp below is in the past.
  const today = businessDate(new Date(Date.now() - 14 * 3_600_000), TZ, "00:00");
  const start = addDays(today, -35);
  const COUNT_DAYS = [-28, -21, -14, -7, 0].map((k) => addDays(today, k));
  const DELIVERY_DAYS = [-28, -21, -14, -7].map((k) => addDays(today, k));

  // Organization, locations, team.
  const orgId = await ok(owner.rpc("create_organization", { p_name: ORG, p_location_name: "Main bar", p_timezone: TZ, p_display_name: PEOPLE[0].name }), "create organization") as string;
  const loc = (await ok(admin.from("locations").select("id").eq("org_id", orgId).single(), "location")).id as string;
  const patio = (await ok(admin.from("locations").insert({ org_id: orgId, name: "Patio", timezone: TZ }).select("id").single(), "patio")).id as string;
  await ok(admin.from("memberships").insert(PEOPLE.slice(1).map((p) => ({ org_id: orgId, user_id: ids[p.key], role: p.role, display_name: p.name }))), "memberships");
  await ok(admin.from("org_settings").update({ target_cost_pct: 22 }).eq("org_id", orgId), "settings");
  log(`created ${ORG} (${orgId})`);

  // Suppliers and products.
  const suppliers = await ok(admin.from("suppliers").insert([{ org_id: orgId, name: "Riverside Wine & Spirits", contact: "orders@riverside.example" }, { org_id: orgId, name: "Northside Produce", contact: "Dana, (555) 010-2231" }]).select("id, name"), "suppliers");
  const supplierId = { spirits: suppliers.find((s) => s.name.startsWith("Riverside"))!.id as string, produce: suppliers.find((s) => s.name.startsWith("Northside"))!.id as string };
  await ok(admin.from("inventory_areas").insert([{ org_id: orgId, location_id: loc, name: "Back bar", sort_order: 1 }, { org_id: orgId, location_id: loc, name: "Walk-in", sort_order: 2 }]), "areas");
  const prows = await ok(admin.from("products").insert(PRODUCTS.map((p) => ({ org_id: orgId, name: p.name, category: p.category, dimension: p.dimension, container_size_base: p.size, container_label: p.label, default_count_method: p.method === "full_units" ? "full_units" : p.method }))).select("id, name"), "products");
  const pid = new Map(prows.map((r) => [r.name as string, r.id as string]));
  await ok(admin.from("product_costs").insert(PRODUCTS.map((p) => ({ org_id: orgId, product_id: pid.get(p.name), cost_per_base: p.cpb, effective_at: at(start, "09:00").toISOString(), source: "manual", created_by: ids.owner }))), "costs");

  // Recipes from the classic library, mapped to products, on the menu.
  const recipeId = new Map<string, string>();
  for (const m of MENU) if (m.tpl) recipeId.set(m.id, await ok(owner.rpc("copy_recipe_template", { p_org: orgId, p_template: m.tpl, p_name: null }), `copy ${m.tpl}`) as string);
  for (const m of MENU) {
    if (!m.custom) continue;
    const id = await ok(owner.rpc("save_recipe_version", {
      p_org: orgId, p_recipe: null, p_name: m.name, p_kind: "drink", p_category: m.custom.category, p_yield_servings: "1", p_yield_qty: null, p_yield_unit: null, p_produces_product: null,
      p_details: { glassware: m.custom.category === "Beer" ? "Pint glass" : "Wine glass", method: m.custom.category === "Beer" ? "Pour from the tap with a two-finger head." : "Pour 150 mL.", garnish: null, batch_instructions: null, notes: null },
      p_components: [{ product_id: pid.get(m.custom.product), qty: String(m.custom.ml), unit: "ml", yield_pct: null, label: null }],
      p_expected_current_version: null, p_template_id: null,
    }), `recipe ${m.name}`) as string;
    recipeId.set(m.id, id);
  }
  const ingredients = await ok(admin.from("ingredients").select("id, name").eq("org_id", orgId), "ingredients");
  for (const ing of ingredients) {
    const product = PRODUCTS.find((p) => p.ingredients.some((n) => n.toLowerCase() === (ing.name as string).toLowerCase()));
    if (product) await ok(owner.rpc("map_ingredient", { p_org: orgId, p_location: loc, p_ingredient: ing.id, p_product: pid.get(product.name) }), `map ${ing.name}`);
  }
  for (const m of MENU) if (recipeId.has(m.id)) await ok(owner.rpc("set_menu_item", { p_org: orgId, p_location: loc, p_recipe: recipeId.get(m.id), p_price: m.price, p_target: null, p_section: m.custom?.category ?? "Cocktails", p_on_menu: true }), `menu ${m.name}`);

  // The bar set its recipes up before the history starts: date the setup accordingly.
  const setup = at(addDays(start, -1), "12:00").toISOString();
  await ok(admin.from("recipe_versions").update({ effective_from: setup }).eq("org_id", orgId), "date recipes");
  await ok(admin.from("ingredient_mappings").update({ effective_from: setup }).eq("org_id", orgId), "date mappings");
  await ok(admin.from("menu_items").update({ effective_from: setup }).eq("org_id", orgId), "date menu");

  // Per-serving product use, computed by the same engine the app uses.
  const app = { supabase: owner, org: { orgId, orgName: ORG, role: "owner" }, location: { id: loc, orgId, name: "Main bar", timezone: TZ, businessDayCutoff: "04:00" }, can: () => true } as unknown as AppContext;
  const cat = await loadCatalog(app);
  const perServing = new Map<string, Map<string, number>>();
  for (const m of MENU) {
    if (!recipeId.has(m.id)) continue;
    const exp = explodeServings(cat.ctx, recipeId.get(m.id)!, 1);
    if (!exp.complete) fail(`${m.name} is incomplete: ${exp.issues.map((i) => i.message).join("; ")}`);
    perServing.set(m.id, new Map([...exp.demand].map(([product, q]) => [product, Number(q.asPurchasedBase ?? q.usableBase)])));
  }

  // ------------------------------------------------ sales: generate five weeks of item selections
  type Sale = { date: string; time: string; item: (typeof MENU)[number]; check: string; sel: string; voided: boolean; comped: boolean };
  const sales: Sale[] = [];
  let checkNo = 4100;
  for (let k = 0; k < 35; k++) {
    const date = addDays(start, k);
    const factor = WEEKDAY[weekday(date)]!;
    for (const item of MENU) {
      const n = Math.round(item.base * factor * (0.75 + rand() * 0.5));
      for (let i = 0; i < n; i++) {
        const minutes = 17 * 60 + Math.floor(rand() * 8 * 60); // 17:00 to 00:59
        const day = minutes >= 24 * 60 ? addDays(date, 1) : date;
        const mm = minutes % (24 * 60);
        const time = `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
        if (rand() < 0.45) checkNo++;
        sales.push({ date: day, time, item, check: `C${checkNo}`, sel: randomUUID().slice(0, 13), voided: rand() < 0.01, comped: rand() < 0.02 });
      }
    }
  }
  sales.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const saleBusinessDate = (s: Sale) => businessDate(at(s.date, s.time), TZ, "04:00");

  // Actual product use per business day: recipe spec times each product's drift.
  const actualByDay = new Map<string, Map<string, number>>();
  for (const s of sales) {
    if (s.voided || !perServing.has(s.item.id)) continue;
    const day = saleBusinessDate(s);
    const m = actualByDay.get(day) ?? new Map<string, number>();
    for (const [product, q] of perServing.get(s.item.id)!) {
      const spec = PRODUCTS.find((p) => pid.get(p.name) === product)!;
      m.set(product, (m.get(product) ?? 0) + q * spec.drift);
    }
    actualByDay.set(day, m);
  }
  const usageBetween = (from: string, to: string) => {
    const out = new Map<string, number>();
    for (let dte = from; dte < to; dte = addDays(dte, 1)) for (const [p, q] of actualByDay.get(dte) ?? []) out.set(p, (out.get(p) ?? 0) + q);
    return out;
  };

  // ------------------------------------------------ physical stock, ledger and counts
  const physical = new Map<string, number>();
  const firstWeek = usageBetween(start, addDays(start, 7));
  const opening = PRODUCTS.map((p) => {
    const id = pid.get(p.name)!;
    const need = (firstWeek.get(id) ?? 0) * 1.6 + (p.size ?? 20) * 2;
    const qty = p.size ? Math.ceil(need / p.size) * p.size : Math.ceil(need);
    physical.set(id, qty);
    return { org_id: orgId, location_id: loc, product_id: id, type: "opening_balance", qty_base: qty, occurred_at: at(start, "10:00").toISOString(), reason: "Opening stock", source_type: "manual", created_by: ids.manager };
  });
  await ok(admin.from("stock_movements").insert(opening), "opening stock");
  let lastDay = start;
  const consumeUntil = (day: string) => {
    for (const [p, q] of usageBetween(lastDay, day)) physical.set(p, (physical.get(p) ?? 0) - q);
    lastDay = day;
  };

  const events: { when: Date; run: () => Promise<void> }[] = [];
  // Weekly deliveries: invoice approved by the manager, then received.
  for (const day of DELIVERY_DAYS) {
    events.push({ when: at(day, "14:00"), run: async () => {
      consumeUntil(day);
      const nextWeek = usageBetween(day, addDays(day, 7));
      for (const sup of ["spirits", "produce"] as const) {
        const lines = PRODUCTS.filter((p) => p.supplier === sup).map((p) => {
          const id = pid.get(p.name)!;
          // Order up to about 1.8 weeks of use plus a spare container, as a cautious buyer would.
          const want = (nextWeek.get(id) ?? 0) * 1.8 + (p.size ?? 30) - (physical.get(id) ?? 0);
          const unit = p.size ?? 1;
          const qty = Math.max(0, Math.ceil(want / unit));
          // Tequila went up 8% from the third delivery: shows cost freshness.
          const price = p.cpb * (p.name === "Blanco Tequila" && day >= DELIVERY_DAYS[2]! ? 1.08 : 1) * unit;
          return { p, id, qty, unit, price: Math.round(price * 100) / 100 };
        }).filter((l) => l.qty > 0);
        if (!lines.length) continue;
        const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
        const inv = await ok(admin.from("invoices").insert({ org_id: orgId, location_id: loc, supplier_id: supplierId[sup], invoice_number: `${sup === "spirits" ? "RWS" : "NP"}-${day.replace(/-/g, "").slice(2)}`, invoice_date: day, subtotal: total.toFixed(2), total: total.toFixed(2), status: "needs_review", created_by: ids.manager }).select("id, version").single(), "invoice");
        const rows = await ok(admin.from("invoice_lines").insert(lines.map((l, i) => ({ org_id: orgId, invoice_id: inv.id, position: i + 1, description: `${l.p.name}${l.p.size ? ` ${l.p.size}${l.p.dimension === "mass" ? "g" : "ml"}` : ""}`, product_id: l.id, quantity: l.qty, units_per_pack: 1, unit_size_base: l.unit, unit_price: l.price, line_total: (l.qty * l.price).toFixed(2), match_status: "confirmed", confidence: "high" }))).select("id, product_id, quantity, unit_size_base, line_total"), "invoice lines");
        await ok(manager.rpc("approve_invoice", { p_org: orgId, p_invoice: inv.id, p_expected_version: inv.version, p_line_costs: rows.map((r) => ({ invoice_line_id: r.id, product_id: r.product_id, cost_per_base: (Number(r.line_total) / (Number(r.quantity) * Number(r.unit_size_base))).toFixed(8) })), p_update_costs: true }), "approve invoice");
        await ok(manager.rpc("receive_invoice", { p_org: orgId, p_invoice: inv.id, p_received_at: at(day, "14:00").toISOString(), p_lines: rows.map((r) => ({ invoice_line_id: r.id, received_quantity: r.quantity, received_base: Number(r.quantity) * Number(r.unit_size_base), extended_cost: r.line_total })), p_notes: null, p_idempotency_key: randomUUID() }), "receive invoice");
        for (const r of rows) physical.set(r.product_id as string, (physical.get(r.product_id as string) ?? 0) + Number(r.quantity) * Number(r.unit_size_base));
      }
    } });
  }
  // A case of Campari arrived with another order but was never invoiced: counts come out high.
  const campariExtra = addDays(today, -17);
  events.push({ when: at(campariExtra, "15:00"), run: async () => { consumeUntil(campariExtra); const id = pid.get("Campari")!; physical.set(id, physical.get(id)! + 6000); } });
  // Logged waste and breakage.
  for (const [k, name, qty, type, reason] of [
    [-25, "Fresh Lime Juice", 400, "waste", "Juice from Friday prep went off"],
    [-19, "Prosecco", 750, "breakage", "Bottle dropped during service"],
    [-12, "Blanco Tequila", 1000, "breakage", "Bottle broke in the well"],
    [-9, "Fresh Lime Juice", 350, "waste", "End-of-night juice discarded"],
    [-4, "Fresh Lemon Juice", 300, "waste", "End-of-night juice discarded"],
  ] as const) {
    const day = addDays(today, k);
    events.push({ when: at(day, "23:30"), run: async () => {
      consumeUntil(day);
      const id = pid.get(name)!;
      await ok(manager.rpc("record_movement", { p_org: orgId, p_location: loc, p_product: id, p_type: type, p_qty_base: String(-qty), p_occurred_at: at(day, "23:30").toISOString(), p_reason: reason, p_idempotency_key: randomUUID() }), "waste");
      physical.set(id, physical.get(id)! - qty);
    } });
  }
  // Six bottles of Prosecco moved to the patio.
  const transferDay = addDays(today, -10);
  events.push({ when: at(transferDay, "16:00"), run: async () => {
    consumeUntil(transferDay);
    const id = pid.get("Prosecco")!;
    await ok(manager.rpc("post_transfer", { p_org: orgId, p_from: loc, p_to: patio, p_lines: [{ product_id: id, qty_base: "4500" }], p_note: "Patio brunch service", p_occurred_at: at(transferDay, "16:00").toISOString() }), "transfer");
    physical.set(id, physical.get(id)! - 4500);
  } });
  // Weekly counts by the bartender, finalized by the manager.
  for (const day of COUNT_DAYS) {
    events.push({ when: at(day, "11:00"), run: async () => {
      consumeUntil(day);
      const s = await ok(clients.bartender.from("count_sessions").insert({ org_id: orgId, location_id: loc, name: `Weekly count`, started_by: ids.bartender, counted_at: at(day, "11:00").toISOString() }).select("id").single(), "count session");
      for (const p of PRODUCTS) {
        const id = pid.get(p.name)!;
        const q = physical.get(id) ?? 0;
        if (q < 0) fail(`${p.name} would be below zero on ${day}; adjust the demo ordering`);
        const args = { p_org: orgId, p_session: s.id, p_product: id, p_area: null, p_method: p.method, p_full_units: null as number | null, p_tenths: null as number | null, p_gross_weight_g: null, p_measured_base: null as number | null };
        if (p.method === "tenths") {
          args.p_full_units = Math.floor(q / p.size!);
          args.p_tenths = Math.min(10, Math.round(((q % p.size!) / p.size!) * 10));
        } else if (p.method === "full_units") {
          args.p_full_units = Math.round(q / p.size!);
        } else {
          args.p_measured_base = p.dimension === "count" ? Math.round(q) : Math.round(q / 10) * 10;
        }
        await ok(clients.bartender.rpc("upsert_count_line", args), `count ${p.name}`);
      }
      const v = await ok(admin.from("count_sessions").select("version").eq("id", s.id).single(), "count version");
      await ok(manager.rpc("finalize_count", { p_org: orgId, p_session: s.id, p_expected_version: v.version }), "finalize count");
    } });
  }
  events.sort((a, b) => a.when.getTime() - b.when.getTime());
  for (const e of events) await e.run();
  log(`stock history: ${DELIVERY_DAYS.length * 2} deliveries, ${COUNT_DAYS.length} counts, waste and a transfer`);

  // ------------------------------------------------ POS imports through the real pipeline, one file per week
  const header = "Location,Order Id,Order #,Sent Date,Order Date,Check Id,Server,Table,Item Selection Id,Item Id,Master Id,SKU,Menu Item,Sales Category,Gross Price,Discnt,Net Price,Qty,Tax,Void?";
  const files = new Map<string, Sale[]>();
  for (const s of sales) {
    const week = addDays(start, Math.floor((Date.parse(saleBusinessDate(s)) - Date.parse(start)) / (7 * 86_400_000)) * 7);
    files.set(week, [...(files.get(week) ?? []), s]);
  }
  let imported = 0;
  for (const [week, rows] of files) {
    const csv = [header, ...rows.map((s) => {
      const gross = s.item.price.toFixed(2);
      const disc = s.comped ? gross : "0.00";
      const net = s.comped ? "0.00" : gross;
      const when = `${usDate(s.date)} ${usTime(s.time)}`;
      return `Main bar,${s.check},${s.check.slice(1)},${when},${when},${s.check},${pick(SERVERS)},${1 + Math.floor(rand() * 14)},${s.sel},${s.item.id},M-${s.item.id},,${s.item.name},${s.item.custom?.category ?? "Cocktails"},${gross},${disc},${net},1,${(Number(net) * 0.0825).toFixed(2)},${s.voided ? "true" : "false"}`;
    })].join("\r\n");
    const docId = randomUUID();
    const path = `org/${orgId}/pos_export/${docId}.csv`;
    const body = Buffer.from(csv, "utf8");
    await ok(admin.storage.from("documents").upload(path, body, { contentType: "text/csv" }), "upload CSV");
    await ok(admin.from("documents").insert({ id: docId, org_id: orgId, location_id: loc, kind: "pos_export", storage_path: path, filename: `ItemSelectionDetails_${week}.csv`, mime_type: "text/csv", size_bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), uploaded_by: ids.manager, retain_until: addDays(today, 730) }), "document");
    const preset = PRESETS.find((p) => p.id === "toast-item-selection")!;
    const imp = await ok(admin.from("pos_imports").insert({ org_id: orgId, location_id: loc, document_id: docId, kind: "transactions", profile: { ...preset, delimiter: "," }, status: "validating", created_by: ids.manager, stats: {} }).select("id").single(), "import");
    await enqueue(orgId, "pos_import_validate", { importId: imp.id }, { createdBy: ids.manager, timeoutSeconds: 600 });
    await runJobs({ maxMs: 300_000, kinds: ["pos_import_validate"] });
    const v = await ok(admin.from("pos_imports").select("status, error").eq("id", imp.id).single(), "import status");
    if (v.status !== "needs_review") fail(`import for ${week} is ${v.status}: ${v.error ?? ""}`);
    await ok(admin.from("pos_imports").update({ status: "committing" }).eq("id", imp.id), "commit");
    await enqueue(orgId, "pos_import_commit", { importId: imp.id }, { createdBy: ids.manager, timeoutSeconds: 600 });
    await runJobs({ maxMs: 300_000, kinds: ["pos_import_commit"] });
    const c = await ok(admin.from("pos_imports").select("status, stats").eq("id", imp.id).single(), "import result");
    if (c.status !== "committed") fail(`import for ${week} did not commit (${c.status})`);
    imported += (c.stats as { inserted: number }).inserted;
  }
  // Map everything with a recipe; the seasonal special stays unmapped for visitors to try.
  await ok(manager.from("pos_item_mappings").insert(MENU.filter((m) => recipeId.has(m.id)).map((m) => ({ org_id: orgId, location_id: loc, item_key: `id:${m.id}`, item_name: m.name, recipe_id: recipeId.get(m.id), not_stock: false, servings_per_unit: "1", effective_from: "2000-01-01", created_by: ids.manager }))), "item mappings");
  log(`imported ${imported} sales lines in ${files.size} files`);

  // ------------------------------------------------ an invoice waiting for review
  const draft = await ok(admin.from("invoices").insert({ org_id: orgId, location_id: loc, supplier_id: supplierId.spirits, invoice_number: `RWS-${today.replace(/-/g, "").slice(2)}`, invoice_date: today, subtotal: "412.80", total: "412.80", status: "needs_review", review_notes: "Entered from the paper invoice; check the matches.", created_by: ids.bartender }).select("id").single(), "draft invoice");
  await ok(admin.from("invoice_lines").insert([
    { org_id: orgId, invoice_id: draft.id, position: 1, description: "LONDON DRY GIN 1L", product_id: pid.get("London Dry Gin"), quantity: 6, units_per_pack: 1, unit_size_base: 1000, unit_price: 24, line_total: "144.00", match_status: "suggested", confidence: "high" },
    { org_id: orgId, invoice_id: draft.id, position: 2, description: "CAMPARI APERITIVO 1L", product_id: pid.get("Campari"), quantity: 4, units_per_pack: 1, unit_size_base: 1000, unit_price: 32, line_total: "128.00", match_status: "suggested", confidence: "medium" },
    { org_id: orgId, invoice_id: draft.id, position: 3, description: "PROSECCO DOC 750ML", product_id: pid.get("Prosecco"), quantity: 12, units_per_pack: 1, unit_size_base: 750, unit_price: 11.7, line_total: "140.40", match_status: "suggested", confidence: "high" },
    { org_id: orgId, invoice_id: draft.id, position: 4, description: "FUEL SURCHARGE", quantity: 1, units_per_pack: 1, unit_price: 0.4, line_total: "0.40", match_status: "unmatched", confidence: "low" },
  ], { defaultToNull: false }), "draft lines");

  // ------------------------------------------------ Bar Book
  const bd = (k: number) => addDays(today, k);
  const entries = await ok(admin.from("barbook_entries").insert([
    { org_id: orgId, location_id: loc, category: "handoff", business_date: bd(-1), title: "Saturday close: mint ran out at 11pm", body: "Mojitos were 86'd for the last hour. Ordered extra mint for Tuesday.", author_id: ids.bartender },
    { org_id: orgId, location_id: loc, category: "announcement", priority: "high", business_date: bd(-2), title: "New Paloma spec from Friday", body: "Up the lime to 22.5 mL and top with 100 mL grapefruit soda. Recipe book is updated.", author_id: ids.manager, requires_ack: true },
    { org_id: orgId, location_id: loc, category: "shortage", business_date: bd(-1), title: "Order more Prosecco for the patio brunch", body: "Patio used six bottles last Sunday.", author_id: ids.bartender, is_task: true, assigned_to: ids.manager, due_date: bd(1) },
    { org_id: orgId, location_id: loc, category: "equipment", business_date: bd(-6), title: "Ice machine drain blocked", body: "Water pooling under the machine at open.", author_id: ids.bartender, is_task: true, assigned_to: ids.manager, status: "resolved", resolved_by: ids.manager, resolved_at: at(bd(-5), "12:00").toISOString(), resolution: "Technician cleared the drain line." },
    { org_id: orgId, location_id: loc, category: "other", business_date: bd(-3), title: "Rota for next month", body: "Two people asked for fewer Sundays. Discuss before publishing.", author_id: ids.manager, visibility: "managers" },
    { org_id: orgId, location_id: loc, category: "prep", business_date: bd(0), title: "Batch simple syrup before Friday", body: "Two litres. Label with the date.", author_id: ids.manager, is_task: true, assigned_to: ids.bartender, due_date: bd(2) },
  ], { defaultToNull: false }).select("id, title"), "bar book");
  const paloma = entries.find((e) => (e.title as string).startsWith("New Paloma"))!;
  await ok(admin.from("barbook_acks").insert({ org_id: orgId, entry_id: paloma.id, user_id: ids.owner }), "ack");

  // ------------------------------------------------ schedule: this week published, next week drafted
  const staff = await ok(admin.from("staff_profiles").insert([
    { org_id: orgId, display_name: PEOPLE[2].name, default_role: "Bartender", user_id: ids.bartender },
    { org_id: orgId, display_name: PEOPLE[1].name, default_role: "Bar manager", user_id: ids.manager },
    { org_id: orgId, display_name: "Jordan Reyes", default_role: "Bartender" },
    { org_id: orgId, display_name: "Priya Natarajan", default_role: "Barback" },
    { org_id: orgId, display_name: "Sam Okafor", default_role: "Bartender" },
  ]).select("id, display_name, default_role"), "staff");
  const monday = (date: string) => addDays(date, -((weekday(date) + 6) % 7));
  for (const [wk, publish] of [[monday(today), true], [addDays(monday(today), 7), false]] as const) {
    const week = await ok(admin.from("schedule_weeks").insert({ org_id: orgId, location_id: loc, week_start: wk, status: publish ? "published" : "draft", published_version: publish ? 1 : 0, published_at: publish ? new Date().toISOString() : null, has_unpublished_changes: !publish }).select("id").single(), "week");
    const shifts: { staff_id: string; role: string; shift_date: string; start_time: string; end_time: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(wk, i);
      const busy = [5, 6].includes(weekday(date));
      const crew = busy ? staff : staff.filter((_, j) => (j + i) % 2 === 0);
      for (const s of crew) shifts.push({ staff_id: s.id as string, role: (s.default_role as string) ?? "Bartender", shift_date: date, start_time: s.default_role === "Bar manager" ? "15:00" : "17:00", end_time: s.default_role === "Barback" ? "23:00" : "01:30" });
    }
    const rows = await ok(admin.from("shifts").insert(shifts.map((s) => {
      const startAt = at(s.shift_date, s.start_time);
      const endAt = s.end_time < s.start_time ? at(addDays(s.shift_date, 1), s.end_time) : at(s.shift_date, s.end_time);
      return { ...s, org_id: orgId, week_id: week.id, starts_at: startAt.toISOString(), ends_at: endAt.toISOString() };
    })).select("id, staff_id, role, shift_date, start_time, end_time, notes"), "shifts");
    if (publish) await ok(admin.from("schedule_publications").insert({ org_id: orgId, week_id: week.id, version: 1, published_by: ids.manager, shifts: rows.map((r) => ({ id: r.id, staff_id: r.staff_id, role: r.role, shift_date: r.shift_date, start: (r.start_time as string).slice(0, 5), end: (r.end_time as string).slice(0, 5), notes: r.notes })) }), "publication");
  }

  // ------------------------------------------------ an upcoming event
  const ev = await ok(admin.from("bev_events").insert({ org_id: orgId, location_id: loc, name: "Rooftop engagement party", event_date: addDays(today, 12), start_time: "19:00", duration_hours: 3, guests: 80, mix: { cocktail: 100, beer: 0, wine: 0, non_alcoholic: 0 }, other_costs: [{ label: "Two bartenders", amount: "360" }, { label: "Glassware rental", amount: "140" }], quote_mode: "margin", quote_pct: 35, notes: "Client wants a signature spritz.", created_by: ids.manager }).select("id").single(), "event");
  await ok(admin.from("bev_event_recipes").insert([["SPR", 50], ["PAL", 30], ["NEG", 20]].map(([k, share]) => ({ org_id: orgId, event_id: ev.id, recipe_id: recipeId.get(k as string), category: "cocktail", share_pct: share }))), "event recipes");

  log(`done. Sign in with ${DEMO_ACCOUNTS.map((a) => a.email).join(", ")}`);
}

main().catch((e) => fail(e instanceof Error ? e.stack ?? e.message : String(e)));
