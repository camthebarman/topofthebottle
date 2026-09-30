import "server-only";
import type { AppContext } from "@/lib/session";

export async function memberNames(app: AppContext): Promise<{ id: string; name: string }[]> {
  const { data } = await app.supabase.from("memberships").select("user_id, display_name, role").eq("org_id", app.org.orgId).eq("status", "active");
  return (data ?? []).map((m: { user_id: string; display_name: string | null; role: string }) => ({ id: m.user_id, name: m.display_name || `${m.role} (${m.user_id.slice(0, 4)})` }));
}
