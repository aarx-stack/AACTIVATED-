import "server-only";
import { log } from "../log";
import { DemoStore } from "./demo-store";
import { seedDemo } from "./demo-seed";

const g = globalThis as unknown as { __cdDemo?: { store: DemoStore; ready: Promise<void> } };

/** One in-memory demo store per server process, seeded once. Resets when the process restarts. */
export async function getDemoStore(): Promise<DemoStore> {
  if (!g.__cdDemo) {
    const store = new DemoStore();
    g.__cdDemo = {
      store,
      ready: seedDemo(store).catch((err) => {
        log.error("demo seed failed", { name: (err as Error).name });
        throw err;
      }),
    };
  }
  await g.__cdDemo.ready;
  return g.__cdDemo.store;
}

export async function resetDemoStore(): Promise<void> {
  g.__cdDemo = undefined;
  await getDemoStore();
}
