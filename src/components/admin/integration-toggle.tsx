"use client";

import { useState, useTransition } from "react";
import { setIntegrationEnabledAction } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";

export function IntegrationToggle({
  provider,
  name,
  enabled,
}: {
  provider: "GOHIGHLEVEL" | "QUICKBOOKS" | "SLACK";
  name: string;
  enabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant={enabled ? "outline" : "primary"}
        disabled={pending}
        aria-label={enabled ? `Turn off ${name}` : `Turn on ${name}`}
        onClick={() =>
          start(async () => {
            const result = await setIntegrationEnabledAction(provider, !enabled);
            setError(result.ok ? null : result.error);
          })
        }
      >
        {enabled ? "Turn off" : "Turn on"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
