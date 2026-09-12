import { AppShell } from "@/components/AppShell";
import { DemoControls } from "@/components/DemoControls";
import { Toasts } from "@/components/ui";
import { store } from "@/data/store";
import { useStoreVersion } from "@/data/useStore";
import { DATA_MODE } from "@/config";
import { AffiliateView } from "@/views/affiliate";
import { AdminView } from "@/views/admin";
import { LiveApp } from "@/views/live/LiveApp";

export default function App() {
  useStoreVersion();
  // Live mode: the deployed Worker's public read-only board (option A).
  if (DATA_MODE === "live") return <LiveApp />;
  // Demo / snapshot: the full in-memory experience with the preview controls.
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
