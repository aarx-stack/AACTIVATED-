import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, selectClass, textareaClass } from "@/components/forms/action-form";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requirePagePermission } from "@/server/auth/session";
import { createDraftAction } from "../actions";

export const metadata: Metadata = { title: "New post" };

export default async function NewPostPage() {
  await requirePagePermission("content.create");
  return (
    <div className="max-w-3xl">
      <Link
        href="/content"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Content Studio
      </Link>
      <PageHeader
        title="New post"
        description="Start a draft. You can ask the writer agent for alternatives before sending it for review."
      />
      <Card>
        <CardContent className="p-6">
          <ActionForm
            action={createDraftAction}
            submitLabel="Create draft"
            className="grid gap-3 md:grid-cols-2"
            testId="new-post"
          >
            <div className="grid gap-1.5 md:col-span-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" required minLength={3} maxLength={120} />
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label htmlFor="caption">Caption</Label>
              <textarea
                id="caption"
                name="caption"
                rows={6}
                required
                minLength={10}
                maxLength={2200}
                className={textareaClass}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="hashtags">Hashtags</Label>
              <Input id="hashtags" name="hashtags" placeholder="#AACTIVATED #Routine" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="channel">Channel</Label>
              <select id="channel" name="channel" className={selectClass} defaultValue="INSTAGRAM">
                <option value="INSTAGRAM">Instagram</option>
                <option value="FACEBOOK">Facebook</option>
                <option value="TIKTOK">TikTok</option>
                <option value="YOUTUBE">YouTube</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plannedFor">Planned date (optional)</Label>
              <Input id="plannedFor" name="plannedFor" type="date" />
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
