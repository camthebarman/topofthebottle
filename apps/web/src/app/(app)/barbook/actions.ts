"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { businessDate } from "@tz/domain";
import { z } from "zod";
import { action, must, zUuid } from "@/lib/action";
import { fromDbError, UserError } from "@/lib/errors";
import { getContext, requirePerm } from "@/lib/session";
import { notify } from "@/server/notify";

const CATEGORY = z.enum(["handoff", "shortage", "prep", "equipment", "event", "announcement", "other"]);

const entrySchema = z.object({
  entryId: z.union([zUuid, z.literal("")]),
  version: z.string().optional(),
  category: CATEGORY,
  priority: z.enum(["low", "normal", "high"]),
  title: z.string().trim().min(1, "Add a title").max(160),
  body: z.string().max(5000).optional(),
  visibility: z.enum(["all", "managers"]),
  isTask: z.string().optional(),
  assignedTo: z.string().optional(),
  dueDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  requiresAck: z.string().optional(),
});

export const saveEntry = action(entrySchema, async (i) => {
  const app = await getContext();
  requirePerm(app, "barbook.write");
  if (i.visibility === "managers") requirePerm(app, "barbook.manage");
  const assignedTo = i.assignedTo && /^[0-9a-f-]{36}$/.test(i.assignedTo) ? i.assignedTo : null;
  const fields = {
    category: i.category,
    priority: i.priority,
    title: i.title,
    body: i.body ?? "",
    visibility: i.visibility,
    is_task: i.isTask === "on" || !!assignedTo,
    assigned_to: assignedTo,
    due_date: i.dueDate || null,
    requires_ack: i.requiresAck === "on",
  };
  let id = i.entryId;
  let previousAssignee: string | null = null;
  if (id) {
    const prev = await app.supabase.from("barbook_entries").select("assigned_to").eq("id", id).maybeSingle();
    previousAssignee = (prev.data?.assigned_to as string | null) ?? null;
    const res = await app.supabase.from("barbook_entries").update({ ...fields, version: Number(i.version) }).eq("id", id).select("id");
    if (res.error) throw fromDbError(res.error);
    if (!res.data?.length) throw new UserError("You can edit your own entries; managers can edit any.", "forbidden");
  } else {
    const row = must(
      await app.supabase
        .from("barbook_entries")
        .insert({ ...fields, org_id: app.org.orgId, location_id: app.location.id, author_id: app.user.id, business_date: businessDate(new Date(), app.location.timezone, app.location.businessDayCutoff) })
        .select("id")
        .single(),
    ) as { id: string };
    id = row.id;
  }
  if (assignedTo && assignedTo !== previousAssignee && assignedTo !== app.user.id) {
    await notify(app.org.orgId, [assignedTo], { kind: "barbook.assigned", title: `Assigned to you: ${i.title}`, link: `/barbook/${id}` });
  }
  if (!i.entryId && i.requiresAck === "on" && i.visibility === "all") {
    const { data: members } = await app.supabase.from("memberships").select("user_id").eq("org_id", app.org.orgId).eq("status", "active");
    await notify(app.org.orgId, (members ?? []).map((m: { user_id: string }) => m.user_id).filter((u: string) => u !== app.user.id), { kind: "barbook.ack", title: `Please read: ${i.title}`, link: `/barbook/${id}` });
  }
  revalidatePath("/barbook");
  redirect(`/barbook/${id}?saved=1`);
});

export const setResolved = action(z.object({ entryId: zUuid, version: z.string(), resolved: z.enum(["true", "false"]), resolution: z.string().max(2000).optional() }), async (i) => {
  const app = await getContext();
  requirePerm(app, "barbook.write");
  const res = await app.supabase
    .from("barbook_entries")
    .update({ status: i.resolved === "true" ? "resolved" : "open", resolution: i.resolution || null, version: Number(i.version) })
    .eq("id", i.entryId)
    .select("id");
  if (res.error) throw fromDbError(res.error);
  if (!res.data?.length) throw new UserError("Only the author, the assignee or a manager can resolve this.", "forbidden");
  revalidatePath("/barbook");
  revalidatePath(`/barbook/${i.entryId}`);
  return { status: "success", message: i.resolved === "true" ? "Resolved" : "Reopened" };
});

export const acknowledge = action(z.object({ entryId: zUuid }), async ({ entryId }) => {
  const app = await getContext();
  requirePerm(app, "barbook.write");
  const res = await app.supabase.from("barbook_acks").upsert({ org_id: app.org.orgId, entry_id: entryId, user_id: app.user.id }, { onConflict: "entry_id,user_id", ignoreDuplicates: true });
  if (res.error) throw fromDbError(res.error);
  revalidatePath(`/barbook/${entryId}`);
  revalidatePath("/barbook");
  return { status: "success", message: "Acknowledged" };
});
