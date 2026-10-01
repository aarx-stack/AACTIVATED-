import { getConfig } from "@/server/config";
import { redirect } from "next/navigation";
import { MfaForm } from "../login-form";

export const dynamic = "force-dynamic";

export default function MfaPage() {
  if (getConfig().dataMode !== "supabase") redirect("/login");
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <section className="glass glass-lit w-full p-6 md:p-8">
        <span className="badge badge-cyan">TWO-FACTOR VERIFICATION</span>
        <h1 className="mt-4 text-xl font-semibold">Enter your authenticator code</h1>
        <p className="mt-2 text-sm text-soft">Your account has MFA enabled. Records stay locked until you verify.</p>
        <div className="mt-6">
          <MfaForm />
        </div>
      </section>
    </main>
  );
}
