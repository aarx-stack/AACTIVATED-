"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Graceful degradation: one failing page never takes down the shell or other pages. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <AlertTriangle className="size-10 text-warning" aria-hidden />
        <h1 className="text-lg font-semibold">This section is temporarily unavailable</h1>
        <p className="text-sm text-muted-foreground">
          The rest of the portal is still working. Try again, or check the system status.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-subtle-foreground">Reference: {error.digest}</p>
        )}
        <div className="mt-2 flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" asChild>
            <Link href="/status">System status</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
