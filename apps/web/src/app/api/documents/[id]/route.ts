import { NextResponse } from "next/server";
import { getContext } from "@/lib/session";
import { signedDocumentUrl } from "@/server/uploads";

// Redirect to a short-lived signed URL, only if RLS lets this member read the document.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const app = await getContext();
  const signed = await signedDocumentUrl(app, id, 120);
  if (!signed) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(signed.url, { headers: { "Cache-Control": "private, no-store" } });
}
