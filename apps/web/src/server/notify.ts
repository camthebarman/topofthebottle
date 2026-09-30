import "server-only";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * In-app notices. Written with the service role (users cannot create
 * notifications for each other) after the caller's action was authorized.
 * Only notifies active members of the same organization.
 */
export async function notify(orgId: string, userIds: string[], n: { kind: string; title: string; body?: string; link?: string }): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return;
  try {
    const admin = createAdminClient();
    const { data: members } = await admin.from("memberships").select("user_id").eq("org_id", orgId).eq("status", "active").in("user_id", unique);
    const rows = (members ?? []).map((m: { user_id: string }) => ({ org_id: orgId, user_id: m.user_id, kind: n.kind, title: n.title.slice(0, 200), body: n.body?.slice(0, 1000) ?? null, link: n.link ?? null }));
    if (rows.length) await admin.from("notifications").insert(rows);
  } catch (e) {
    // A failed notice must not undo the action that caused it; it is logged instead.
    log("warn", "notify.failed", { orgId, kind: n.kind, error: e instanceof Error ? e.message : String(e) });
  }
}
