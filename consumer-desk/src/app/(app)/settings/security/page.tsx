import { Card, Notice, PageHeader } from "@/components/ui";
import { requireOwner } from "@/server/context";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { MfaEnroll } from "./mfa-enroll";

export const dynamic = "force-dynamic";

export default async function SecurityPage(props: PageProps<"/settings/security">) {
  const ctx = await requireOwner({ allowMfaEnrollment: true });
  const sp = await props.searchParams;
  let verified = 0;
  if (!ctx.isDemo) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.mfa.listFactors();
    verified = data?.totp?.filter((f) => f.status === "verified").length ?? 0;
  }
  return (
    <div className="max-w-2xl">
      <PageHeader title="Security & MFA" description="Multi-factor authentication for the connected owner account." />
      {sp.required === "1" && (
        <div className="mb-4"><Notice tone="warn" title="MFA required">REQUIRE_MFA is enabled. Enroll an authenticator app to continue.</Notice></div>
      )}
      <Card lit>
        {ctx.isDemo ? (
          <p className="text-sm text-soft">Demo mode has no real accounts. MFA applies to the connected Supabase owner account.</p>
        ) : verified > 0 ? (
          <Notice tone="ok">An authenticator app is enrolled. Database policies require a verified code (AAL2) for every request.</Notice>
        ) : (
          <>
            <p className="mb-4 text-sm text-soft">
              Once enrolled, every sign-in requires a 6-digit code, and the database itself refuses access to records without it.
            </p>
            <MfaEnroll />
          </>
        )}
      </Card>
    </div>
  );
}
