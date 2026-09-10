import { AppShell } from "@/components/AppShell";
import { DemoControls } from "@/components/DemoControls";
import { Toasts } from "@/components/ui";
import { store } from "@/data/store";
import { useStoreVersion } from "@/data/useStore";
import { DATA_MODE } from "@/config";
import { AffiliateView } from "@/views/affiliate";
import { AdminView } from "@/views/admin";

function LiveModeGate() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="panel panel-strong max-w-lg p-8 text-center">
        <h1 className="font-display m-0 text-2xl text-mist-50">Live mode isn’t connected yet</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-mist-400">
          This build was started with <code>VITE_DATA_MODE=live</code>, but the Worker API needs
          deployed credentials and real authentication first — see <code>docs/SETUP.md</code>.
          Nothing is ever faked in live mode; until the API is connected, use the demo build.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  useStoreVersion();
  if (DATA_MODE === "live") return <LiveModeGate />;
  return (
    <>
      <AppShell view={store.view}>
        {store.view === "admin" ? <AdminView /> : <AffiliateView />}
      </AppShell>
      <DemoControls />
      <Toasts />
    </>
  );
}
