import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/auth", "/invite", "/api/health", "/api/stripe/webhook", "/offline"];

function csp(nonce: string, supabaseUrl: string): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ` 'nonce-${nonce}'`}`,
    `img-src 'self' blob: data: ${supabaseUrl}`,
    `frame-src 'self' ${supabaseUrl}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const correlationId = request.headers.get("x-correlation-id")?.slice(0, 64) || crypto.randomUUID();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const policy = csp(nonce, supabaseUrl);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-correlation-id", correlationId);
  requestHeaders.set("Content-Security-Policy", policy);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Refresh the auth session cookie if needed; identity is verified with getClaims().
  const supabase = createServerClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims?.sub;
  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(path)}`;
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", policy);
    return redirect;
  }

  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("x-correlation-id", correlationId);
  // Authenticated pages are private; never cache them in shared caches.
  if (!isPublic || signedIn) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
