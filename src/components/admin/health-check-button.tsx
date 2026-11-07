"use client";

import { RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { runHealthCheckAction, type ActionResult } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";

export function HealthCheckButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="flex items-center gap-3">
      <span aria-live="polite" className="text-sm text-muted-foreground">
        {result && (result.ok ? result.message : result.error)}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await runHealthCheckAction()))}
      >
        <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden /> Run health check
      </Button>
    </div>
  );
}
