"use client";

import { Download } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

const STANDALONE = "(display-mode: standalone)";
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(STANDALONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
import { Button } from "@/components/ui/button";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install on your phone". Android and desktop Chrome offer a one-tap install; iPhone installs
 * from Safari's Share menu. Already installed: says so.
 */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [justInstalled, setInstalled] = useState(false);
  const standalone = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(STANDALONE).matches,
    () => false,
  );
  const installed = standalone || justInstalled;

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return <p className="text-sm text-success">Installed. You are using the app.</p>;
  }
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="install-app">
      {prompt && (
        <div>
          <Button
            type="button"
            onClick={async () => {
              await prompt.prompt();
              const choice = await prompt.userChoice;
              if (choice.outcome === "accepted") setInstalled(true);
              setPrompt(null);
            }}
          >
            <Download aria-hidden /> Install the app
          </Button>
        </div>
      )}
      <div>
        <p className="font-semibold">iPhone or iPad</p>
        <p className="text-muted-foreground">
          Open this site in Safari, tap the Share button, then <b>Add to Home Screen</b>.
        </p>
      </div>
      <div>
        <p className="font-semibold">Android</p>
        <p className="text-muted-foreground">
          Open this site in Chrome, tap the menu (three dots), then <b>Install app</b> (or{" "}
          <b>Add to Home screen</b>).
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        It opens full screen like any other app and signs in with your emailed link. No app store
        needed.
      </p>
    </div>
  );
}
