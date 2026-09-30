import { Card, Notice, PageHeader } from "@/components/ui";
import { getContext } from "@/lib/session";
import { TotpSetup } from "./forms";

export const metadata = { title: "Security" };

export default async function SecurityPage() {
  const app = await getContext();
  const { data } = await app.supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).filter((f) => f.status === "verified");
  const privileged = app.org.role === "owner" || app.org.role === "manager";
  return (
    <>
      <PageHeader title="Security" />
      <Card title="Two-factor authentication">
        {verified.length ? (
          <Notice tone="ok">On. You will be asked for a code from your authenticator app when you sign in.</Notice>
        ) : (
          <>
            {privileged ? <Notice tone="warn">You can see costs, invoices and your team. Turn on two-factor authentication to protect them.</Notice> : null}
            <div className="mt-3"><TotpSetup /></div>
          </>
        )}
      </Card>
    </>
  );
}
