import Link from "next/link";
import { Card, Notice } from "@/components/ui";
import { getUser } from "@/lib/session";
import { AcceptInviteForm } from "./form";

export const metadata = { title: "Join a team" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUser();
  const next = `/invite/${token}`;
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-10">
      <Card title="You have been invited">
        {user ? (
          <>
            <p className="mb-4 text-sm text-muted">Signed in as {user.email}. The invitation must match this email address.</p>
            <AcceptInviteForm token={token} />
          </>
        ) : (
          <div className="space-y-3">
            <Notice>Sign in or create an account with the email address the invitation was sent to.</Notice>
            <div className="flex gap-2">
              <Link className="font-medium text-accent underline" href={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
              <span>·</span>
              <Link className="font-medium text-accent underline" href={`/sign-up?next=${encodeURIComponent(next)}`}>Create account</Link>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}
