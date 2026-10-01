import Link from "next/link";
import { Card, Notice } from "@/components/ui";
import { DEMO_ACCOUNTS, demoPassword, isDemo } from "@/lib/demo";
import { DemoSignIn, MagicLinkForm, SignInForm } from "../auth-forms";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      {sp.signed_out ? <Notice tone="ok" role="status">You are signed out.</Notice> : null}
      {sp.error ? <Notice tone="danger" role="alert">That link is invalid or has expired. Try again.</Notice> : null}
      {isDemo() && demoPassword() ? (
        <Card title="Try the demo">
          <p className="mb-3 text-sm text-muted">A cocktail bar with five weeks of invented sales, deliveries and counts. Pick a role to see what each person can do.</p>
          <DemoSignIn accounts={DEMO_ACCOUNTS} password={demoPassword()!} next={sp.next} />
          <p className="mt-3 text-xs text-muted">Or sign in below with any of these emails and the password <span className="font-mono">{demoPassword()}</span>.</p>
        </Card>
      ) : null}
      <Card title="Sign in">
        <SignInForm next={sp.next} />
      </Card>
      {isDemo() ? null : (
        <Card title="Or use an email link">
          <MagicLinkForm next={sp.next} />
        </Card>
      )}
      {isDemo() ? null : <p className="text-center text-sm">
        New here? <Link className="font-medium text-accent underline" href={`/sign-up${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`}>Create an account</Link>
      </p>}
    </div>
  );
}
