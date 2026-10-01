"use server";

import type { ActionState } from "@/lib/action-state";
import { act, address, bool, str, strOrNull } from "@/server/actions-helpers";
import { UserError } from "@/server/services/errors";
import {
  createDraftFromPacket,
  createLetter,
  setAttachments,
  updateLetter,
  type LetterContentInput,
} from "@/server/services/letters";
import { approvePacket, preparePacket, requestQuote } from "@/server/services/packets";
import { deleteTemplate, saveTemplate } from "@/server/services/templates";

function content(fd: FormData): LetterContentInput {
  const service = str(fd, "service") === "certified" ? "certified" : "first_class";
  return {
    title: str(fd, "title"),
    letter_type: str(fd, "letter_type"),
    sender_address: address(fd, "sender"),
    recipient_name: str(fd, "recipient_name"),
    recipient_address: address(fd, "recipient"),
    body: str(fd, "body"),
    mail_options: { service, return_receipt: service === "certified" && bool(fd, "return_receipt") },
    expects_response: bool(fd, "expects_response"),
  };
}

function idList(fd: FormData, key: string): string[] {
  return str(fd, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createLetterAction(_p: ActionState, fd: FormData) {
  return act("letter.create", async (ctx) => {
    const row = await createLetter(ctx, {
      client_id: str(fd, "client_id"),
      case_id: str(fd, "case_id"),
      template_id: strOrNull(fd, "template_id"),
      title: str(fd, "title") || undefined,
    });
    return { redirectTo: `/letters/${row.id}?created=1` };
  });
}

export async function saveLetterAction(_p: ActionState, fd: FormData) {
  return act("letter.save", async (ctx) => {
    const id = str(fd, "id");
    await updateLetter(ctx, id, content(fd));
    await setAttachments(ctx, id, idList(fd, "attachments"));
    if (str(fd, "intent") === "prepare") {
      const packet = await preparePacket(ctx, id);
      return { redirectTo: `/packets/${packet.id}` };
    }
    return { message: "Draft saved." };
  });
}

export async function preparePacketAction(_p: ActionState, fd: FormData) {
  return act("packet.prepare", async (ctx) => {
    const packet = await preparePacket(ctx, str(fd, "letter_id"));
    const back = str(fd, "return_to");
    return { redirectTo: back.startsWith("/") ? back.replace(":packet", packet.id) : `/packets/${packet.id}` };
  });
}

export async function approvePacketAction(_p: ActionState, fd: FormData) {
  return act("packet.approve", async (ctx) => {
    if (str(fd, "require_recipient_review") === "1" && !bool(fd, "reviewed_recipient")) {
      throw new UserError("Confirm that you reviewed the recipient.");
    }
    await approvePacket(ctx, str(fd, "packet_id"), {
      packetHash: str(fd, "packet_hash"),
      reviewedPacket: bool(fd, "reviewed_packet"),
    });
    const back = str(fd, "return_to");
    return back.startsWith("/") ? { redirectTo: back } : { message: "Packet approved. It has not been sent." };
  });
}

export async function requestQuoteAction(_p: ActionState, fd: FormData) {
  return act("packet.quote", async (ctx) => {
    const result = await requestQuote(ctx, str(fd, "packet_id"));
    if (result.kind === "quote") return { message: `Quote received: ${(result.cents / 100).toFixed(2)} ${result.currency}.` };
    throw new UserError(`No quote available: ${result.message}`);
  });
}

export async function createDraftFromPacketAction(_p: ActionState, fd: FormData) {
  return act("letter.copy", async (ctx) => {
    const row = await createDraftFromPacket(ctx, str(fd, "packet_id"));
    return { redirectTo: `/letters/${row.id}?copied=1` };
  });
}

export async function saveTemplateAction(_p: ActionState, fd: FormData) {
  return act("template.save", async (ctx) => {
    await saveTemplate(ctx, strOrNull(fd, "id"), {
      name: str(fd, "name"),
      letter_type: str(fd, "letter_type"),
      body: str(fd, "body"),
    });
    return { redirectTo: "/templates?saved=1" };
  });
}

export async function deleteTemplateAction(_p: ActionState, fd: FormData) {
  return act("template.delete", async (ctx) => {
    await deleteTemplate(ctx, str(fd, "id"));
    return { message: "Template deleted." };
  });
}
