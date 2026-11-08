"use server";

import { redirect } from "next/navigation";
import { unsubscribe } from "@/server/email/campaigns";

export async function confirmUnsubscribe(formData: FormData) {
  const token = String(formData.get("t") ?? "");
  const result = await unsubscribe(token);
  redirect(result.ok ? "/unsubscribe?done=1" : "/unsubscribe?invalid=1");
}
