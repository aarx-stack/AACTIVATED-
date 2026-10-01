import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { requireOwner } from "@/server/context";
import { getSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

const MODE_STYLE: Record<string, string> = {
  DEMO: "badge-violet",
  MOCK: "badge-cyan",
  "PROVIDER TEST": "badge-amber",
  LIVE: "badge-red",
  MISCONFIGURED: "badge-red",
};

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireOwner();
  const settings = await getSettings(ctx);
  const policy = ctx.policy;

  const accentStyle = {
    "--accent": settings.accent_primary,
    "--accent-2": settings.accent_highlight,
    "--accent-3": settings.accent_violet,
  } as React.CSSProperties;

  return (
    <div className="flex min-h-screen" style={accentStyle}>
      <Sidebar appName={settings.app_name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#070b14]/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 pl-16 md:px-6 md:pl-6">
            <form action="/search" className="min-w-0 flex-1" role="search">
              <label className="sr-only" htmlFor="global-search">
                Search clients, cases, recipients, tracking numbers
              </label>
              <input
                id="global-search"
                name="q"
                className="input max-w-xl"
                placeholder="Search clients, cases, recipients, tracking or provider refs…"
                autoComplete="off"
              />
            </form>
            <span
              className={`badge ${MODE_STYLE[policy.indicator] ?? ""} px-3 py-1.5 text-[0.7rem] sm:text-xs`}
              title={policy.blockedReason ?? policy.label}
              data-testid="mode-indicator"
            >
              <span className="h-2 w-2 rounded-full bg-current" aria-hidden />
              <span className="hidden sm:inline">{policy.label}</span>
              <span className="sm:hidden">{policy.indicator}</span>
            </span>
            <form action={logoutAction}>
              <button type="submit" className="btn btn-sm" data-testid="logout">
                Sign out
              </button>
            </form>
          </div>
          {ctx.isDemo && (
            <div className="border-t border-violet/30 bg-violet/10 px-4 py-1.5 text-center text-xs font-semibold text-[#dccfff] md:px-6">
              FICTIONAL DEMO DATA — stored in server memory only and reset when the server restarts. Mailing is simulated;
              nothing is sent.
            </div>
          )}
          {policy.indicator === "LIVE" && policy.canSubmit && (
            <div className="border-t border-danger/40 bg-danger/15 px-4 py-1.5 text-center text-xs font-bold text-[#ffd6dc]">
              LIVE MAILING ENABLED — submissions can create real mail and real charges.
            </div>
          )}
          {policy.indicator === "MISCONFIGURED" && (
            <div className="border-t border-danger/40 bg-danger/15 px-4 py-1.5 text-center text-xs font-semibold text-[#ffd6dc]">
              Mailing is blocked: {policy.blockedReason} <Link href="/settings" className="underline">Settings</Link>
            </div>
          )}
        </header>
        <main className="page-enter mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
