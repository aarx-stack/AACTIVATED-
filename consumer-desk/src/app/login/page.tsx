import { headers } from "next/headers";
import { Envelope3D } from "@/components/envelope";
import { demoLoginAllowed, getConfig } from "@/server/config";
import { DemoLoginForm, OwnerLoginForm } from "./login-form";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  forbidden: "That account is not authorised for this workspace, or demo access is not allowed from this address.",
  config: "The application is not fully configured. Check the environment variables listed in the README.",
  unavailable: "The database or authentication service could not be reached. No data was shown. Try again shortly.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const config = getConfig();
  const host = (await headers()).get("host");
  const demo = config.dataMode === "demo";
  const demoAllowed = demoLoginAllowed(config, host);
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 items-center gap-10 px-4 py-10 md:grid-cols-2 md:px-8">
      <section className="page-enter">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan">Private workspace</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink md:text-5xl">Consumer Desk</h1>
        <p className="mt-4 max-w-md text-soft">
          Organise client records, prepare correspondence, review complete mailing packets and track every mailing and
          response — for a single owner.
        </p>
        <Envelope3D className="mt-16 hidden h-56 items-center justify-center pl-16 sm:flex" />
      </section>

      <section className="glass glass-lit page-enter w-full max-w-md justify-self-center p-6 md:p-8">
        {demo ? (
          <>
            <span className="badge badge-violet">DEMO MODE · FICTIONAL DATA</span>
            <h2 className="mt-4 text-xl font-semibold">Local demo workspace</h2>
            <p className="mt-2 text-sm text-soft">
              Three fictional clients are preloaded. Demo data lives only in server memory and{" "}
              <strong>resets whenever the server restarts</strong>. Mailing is simulated by the mock provider — nothing
              is ever sent. Do not enter real people or real identity documents.
            </p>
            <div className="mt-6">
              {demoAllowed ? (
                <DemoLoginForm />
              ) : (
                <p className="notice notice-danger" role="alert">
                  Demo sign-in is disabled here. It only works on localhost during local development, and never on a
                  deployed production server.
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="badge badge-blue">CONNECTED · OWNER ONLY</span>
            <h2 className="mt-4 text-xl font-semibold">Owner sign-in</h2>
            <p className="mt-2 text-sm text-soft">Public registration is disabled. Only the configured owner account can sign in.</p>
            <div className="mt-6">
              <OwnerLoginForm />
            </div>
          </>
        )}
        {error && (
          <p className="notice notice-danger mt-4" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
