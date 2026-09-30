import "server-only";
import { headers } from "next/headers";
import { UserError } from "@/lib/errors";

/**
 * Fixed-window limiter held in process memory. It protects a single instance
 * against bursts (sign-in guessing, upload floods). Multi-instance deployments
 * also rely on Supabase Auth's own limits and the database-backed tenant
 * allowances in usage_counters; see docs/threat-model.md.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= limit;
}

export async function limit(scope: string, id: string, max: number, windowMs: number): Promise<void> {
  if (!hit(`${scope}:${id}`, max, windowMs)) {
    throw new UserError("Too many attempts. Wait a minute and try again.", "limit");
  }
}
