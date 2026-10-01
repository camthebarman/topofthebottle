import { Badge, EmptyState, ListLink, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { dateLabel } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { EventForm } from "./forms";

export const metadata = { title: "Events" };

export default async function EventsPage() {
  const app = await getContext();
  pagePerm(app, "events.manage");
  const events = must(await app.supabase.from("bev_events").select("id, name, event_date, guests, status").eq("location_id", app.location.id).order("event_date", { ascending: false }).limit(100)) as { id: string; name: string; event_date: string; guests: number; status: string }[];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Beverage events" description="Plan drinks for private events and catering. Plans never move stock on their own." />
      <div className="space-y-4">
        <details className="rounded-xl border border-border bg-surface p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">Plan a new event</summary>
          <div className="mt-3">
            <EventForm initial={{ eventId: "", version: "", name: "", eventDate: today, startTime: "18:00", durationHours: "4", guests: "100", participationPct: "85", firstHourDrinks: "2", laterHourDrinks: "1", contingencyPct: "10", mix: { cocktail: "50", beer: "25", wine: "20", non_alcoholic: "5" }, consumables: { iceLbPerParticipant: "1.5", chillIceLbPerBottleDrink: "0.25", cupsPerDrink: "1.2", napkinsPerDrink: "1.5" }, otherCosts: "", quoteMode: "margin", quotePct: "30", notes: "" }} />
          </div>
        </details>
        {events.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {events.map((e) => <ListLink key={e.id} href={`/events/${e.id}`} title={e.name} meta={`${dateLabel(e.event_date)} · ${e.guests} guests`} right={<Badge tone={e.status === "confirmed" ? "ok" : e.status === "cancelled" ? "neutral" : "warn"}>{e.status}</Badge>} />)}
          </ul>
        ) : <EmptyState title="No events yet" />}
      </div>
    </>
  );
}
