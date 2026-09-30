import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const safeNext = (n: string | null) => (n && /^\/[A-Za-z0-9/_-]*$/.test(n) && !n.startsWith("//") ? n : "/today");

// Email links (sign-up confirmation, magic link) land here.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"));
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  const target = request.nextUrl.clone();
  target.search = "";
  target.pathname = ok ? next : "/sign-in";
  if (!ok) target.searchParams.set("error", "link");
  return NextResponse.redirect(target);
}
