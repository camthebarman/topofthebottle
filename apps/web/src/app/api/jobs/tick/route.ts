import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runJobs } from "@/server/jobs";
import { runRetention } from "@/server/retention";

// Called by a scheduler (cron) with a shared secret. Processes queued jobs for up to ~50 s.
export async function POST(request: Request) {
  const secret = process.env.JOBS_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || secret.length < 32 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const processed = await runJobs({ maxMs: 45_000 });
  const retention = await runRetention();
  return NextResponse.json({ processed, retention });
}
