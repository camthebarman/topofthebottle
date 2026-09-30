import Link from "next/link";
import { Card } from "@/components/ui";
import { SignUpForm } from "../auth-forms";

export const metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <Card title="Create your account">
        <SignUpForm next={sp.next} />
      </Card>
      <p className="text-center text-sm">
        Have an account? <Link className="font-medium text-accent underline" href="/sign-in">Sign in</Link>
      </p>
    </div>
  );
}
