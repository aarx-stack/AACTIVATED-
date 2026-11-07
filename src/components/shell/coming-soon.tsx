import { Hammer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "./page-header";

/** Placeholder for pages scheduled in a later phase. Access is still enforced by the page. */
export function ComingSoon({
  title,
  phase,
  description,
  scope,
}: {
  title: string;
  phase: number;
  description: string;
  scope: string[];
}) {
  return (
    <>
      <PageHeader eyebrow={`Phase ${phase}`} title={title} description={description} />
      <Card className="max-w-2xl">
        <CardContent className="flex gap-4 p-6">
          <Hammer className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="font-medium">Scheduled for Phase {phase}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {scope.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
