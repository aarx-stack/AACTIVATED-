"use server";

import type { ActionState } from "@/lib/action-state";
import { act, bool, fileFrom, str, strOrNull } from "@/server/actions-helpers";
import { createFollowUp, recordResponse, setFollowUpDone, updateResponse } from "@/server/services/responses";
import type { FollowUpKind, ResponseRecordStatus } from "@/server/types";

export async function recordResponseAction(_p: ActionState, fd: FormData) {
  return act(
    "response.record",
    async (ctx) => {
      const row = await recordResponse(ctx, {
        client_id: str(fd, "client_id"),
        case_id: str(fd, "case_id"),
        mailing_id: strOrNull(fd, "mailing_id"),
        received_date: str(fd, "received_date"),
        sender_name: str(fd, "sender_name"),
        notes: str(fd, "notes"),
        next_action: str(fd, "next_action"),
        follow_up_date: strOrNull(fd, "follow_up_date"),
        file: await fileFrom(fd, "file"),
        demo_fictional_ack: bool(fd, "demo_fictional_ack"),
      });
      return { redirectTo: `/responses/${row.id}?created=1` };
    },
    { limit: 30 },
  );
}

export async function updateResponseAction(_p: ActionState, fd: FormData) {
  return act("response.update", async (ctx) => {
    await updateResponse(ctx, str(fd, "id"), {
      status: str(fd, "status") as ResponseRecordStatus,
      notes: str(fd, "notes"),
      next_action: str(fd, "next_action"),
      follow_up_date: strOrNull(fd, "follow_up_date"),
    });
    return { message: "Response updated." };
  });
}

export async function createFollowUpAction(_p: ActionState, fd: FormData) {
  return act("follow_up.create", async (ctx) => {
    await createFollowUp(ctx, {
      client_id: str(fd, "client_id"),
      case_id: strOrNull(fd, "case_id"),
      mailing_id: strOrNull(fd, "mailing_id"),
      response_id: strOrNull(fd, "response_id"),
      kind: (str(fd, "kind") || "other") as FollowUpKind,
      title: str(fd, "title"),
      due_date: str(fd, "due_date"),
      notes: str(fd, "notes"),
    });
    return { message: "Follow-up created." };
  });
}

export async function toggleFollowUpAction(_p: ActionState, fd: FormData) {
  return act("follow_up.toggle", async (ctx) => {
    const done = str(fd, "done") === "true";
    await setFollowUpDone(ctx, str(fd, "id"), done);
    return { message: done ? "Marked complete." : "Reopened." };
  });
}
