import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { readUnsubscribeToken } from "@/server/email/campaigns";
import { confirmUnsubscribe } from "./actions";

export const metadata: Metadata = { title: "Unsubscribe" };
export const dynamic = "force-dynamic";

/** Public: the link at the bottom of every email. One click on the button, no sign-in. */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; done?: string; invalid?: string }>;
}) {
  const { t, done, invalid } = await searchParams;
  const valid = t ? readUnsubscribeToken(t) !== null : false;

  return (
    <div className="relative z-10 mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4 py-12">
      <p className="text-sm font-semibold tracking-[0.2em]">AACTIVATED RX</p>
      <Card className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">
          {done ? "You are unsubscribed" : "Unsubscribe from AACTIVATED emails"}
        </h1>
        {done ? (
          <p className="text-sm text-muted-foreground">
            You will not receive these emails again. It can take a moment for every list to update.
          </p>
        ) : invalid || !valid ? (
          <p className="text-sm text-muted-foreground">
            This unsubscribe link is not valid. Use the link at the bottom of the email, or reply to
            the email and ask to be removed.
          </p>
        ) : (
          <form action={confirmUnsubscribe} className="flex flex-col gap-4">
            <input type="hidden" name="t" value={t} />
            <p className="text-sm text-muted-foreground">
              Confirm and we will stop sending you these emails.
            </p>
            <div>
              <Button type="submit">Unsubscribe</Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
