"use client";

import { useState, useTransition } from "react";
import { disconnectQuickBooksAction } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";

/** Connect / disconnect controls for the QuickBooks OAuth connection. */
export function QuickBooksConnect({ connected }: { connected: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!connected) {
    return (
      <Button asChild size="sm">
        <a href="/api/integrations/quickbooks/connect">Connect QuickBooks</a>
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (
              !window.confirm("Disconnect QuickBooks? Syncing stops until it is connected again.")
            )
              return;
            const result = await disconnectQuickBooksAction();
            setMessage(
              result.ok
                ? { ok: true, text: result.message ?? "Disconnected." }
                : { ok: false, text: result.error },
            );
          })
        }
      >
        Disconnect QuickBooks
      </Button>
      {message && (
        <span role={message.ok ? "status" : "alert"} className="text-xs text-muted-foreground">
          {message.text}
        </span>
      )}
    </span>
  );
}
