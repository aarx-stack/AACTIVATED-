"use client";

import { Pause, Play } from "lucide-react";
import { useState, useTransition } from "react";
import { setAgentPausedAction } from "@/app/(app)/agents/actions";
import { Button } from "@/components/ui/button";

export function PauseButton({ agentId, paused }: { agentId: string; paused: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-sm text-danger">{error}</span>}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await setAgentPausedAction(agentId, !paused);
            setError(result.ok ? null : result.error);
          })
        }
      >
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        {paused ? "Resume agent" : "Pause agent"}
      </Button>
    </div>
  );
}
