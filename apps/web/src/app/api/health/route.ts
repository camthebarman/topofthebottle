import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Liveness plus a database round trip. Reveals no tenant data.
export async function GET() {
  const started = Date.now();
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("permissions").select("id", { head: true, count: "exact" });
    const { count: stuck } = await admin.from("jobs").select("id", { head: true, count: "exact" }).eq("status", "queued").lt("run_after", new Date(Date.now() - 15 * 60_000).toISOString());
    return NextResponse.json({ ok: !error, db: error ? "error" : "ok", queued_over_15m: stuck ?? 0, ms: Date.now() - started }, { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: "unconfigured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
