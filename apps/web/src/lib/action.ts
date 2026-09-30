import "server-only";
import { z } from "zod";
import { fromDbError, UserError } from "@/lib/errors";
import { correlationId, log } from "@/lib/log";

import type { ActionState } from "@/lib/action-state";
export type { ActionState };

/** Turn FormData into a plain object, keeping repeated keys as arrays. */
export function formObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const value = typeof v === "string" ? v : v;
    if (k in out) {
      const prev = out[k];
      out[k] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else out[k] = value;
  }
  return out;
}

/**
 * Wrap a server action: validate input, run, and convert failures into a
 * displayable state. Authorization happens inside `fn` (and again in the DB).
 */
export function action<S extends z.ZodType, T>(schema: S, fn: (input: z.infer<S>) => Promise<ActionState<T> | void>) {
  return async (_prev: ActionState<T>, fd: FormData): Promise<ActionState<T>> => {
    const parsed = schema.safeParse(formObject(fd));
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return { status: "error", message: "Check the highlighted fields.", fieldErrors };
    }
    try {
      return (await fn(parsed.data)) ?? { status: "success" };
    } catch (err) {
      if (isRedirect(err)) throw err;
      if (err instanceof UserError) return { status: "error", message: err.message };
      log("error", "action.failed", { correlationId: await correlationId(), error: err instanceof Error ? err.message : String(err) });
      return { status: "error", message: "Something went wrong and nothing was saved. Please try again." };
    }
  };
}

function isRedirect(err: unknown): boolean {
  const digest = (err as { digest?: string } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

/** Unwrap a Supabase result or throw a displayable error. */
export function must<T>(res: { data: T | null; error: { code?: string; message?: string } | null }, fallback?: string): T {
  if (res.error) throw fromDbError(res.error, fallback);
  if (res.data === null) throw new UserError(fallback ?? "Not found.", "not_found");
  return res.data;
}

export const zUuid = z.uuid();
export const zText = (max: number) => z.string().trim().max(max);
export const zRequired = (max: number) => z.string().trim().min(1, "Required").max(max);
export const zNumberString = z
  .string()
  .trim()
  .regex(/^-?(\d+\.?\d*|\.\d+)$/, "Enter a number");
export const zOptionalNumber = z
  .string()
  .optional()
  .transform((s) => (s === undefined || s.trim() === "" ? null : s.trim()))
  .refine((s) => s === null || /^-?(\d+\.?\d*|\.\d+)$/.test(s), "Enter a number");
