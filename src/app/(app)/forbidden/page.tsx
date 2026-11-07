import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser, homePathFor } from "@/server/auth/session";

export const metadata: Metadata = { title: "No access" };

export default async function ForbiddenPage() {
  const user = await requireUser();
  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <ShieldAlert className="size-10 text-warning" aria-hidden />
        <h1 className="text-lg font-semibold">You do not have access to this area</h1>
        <p className="text-sm text-muted-foreground">
          Some areas, such as legal, corporate accounting and HR, are limited to executives. Ask an
          administrator if you believe you need access.
        </p>
        <Button asChild className="mt-2">
          <Link href={homePathFor(user.role)}>Go to my home page</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
