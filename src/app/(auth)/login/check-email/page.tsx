import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <div className="relative z-10 flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <MailCheck className="size-10 text-primary" aria-hidden />
          <h1 className="text-lg font-semibold">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            If that address has an account, a sign-in link is on its way. The link expires in 15
            minutes.
          </p>
          <Link
            href="/login"
            className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
