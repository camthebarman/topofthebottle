import Link from "next/link";
import { Card, Notice } from "@/components/ui";
import { MagicLinkForm, SignInForm } from "../auth-forms";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      {sp.signed_out ? <Notice tone="ok" role="status">You are signed out.</Notice> : null}
      {sp.error ? <Notice tone="danger" role="alert">That link is invalid or has expired. Try again.</Notice> : null}
      <Card title="Sign in">
        <SignInForm next={sp.next} />
      </Card>
      <Card title="Or use an email link">
        <MagicLinkForm next={sp.next} />
      </Card>
      <p className="text-center text-sm">
        New here? <Link className="font-medium text-accent underline" href={`/sign-up${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`}>Create an account</Link>
      </p>
    </div>
  );
}
