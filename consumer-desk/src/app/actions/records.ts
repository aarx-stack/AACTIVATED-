"use server";

import type { ActionState } from "@/lib/action-state";
import { act, bool, fileFrom, str, strOrNull } from "@/server/actions-helpers";
import {
  addNote,
  createCase,
  createClient,
  deleteClient,
  setClientArchived,
  updateCase,
  updateClient,
  type CaseInput,
  type ClientInput,
} from "@/server/services/clients";
import { deleteDocument, uploadDocument } from "@/server/services/documents";
import { UserError } from "@/server/services/errors";
import type { CaseStatus, DocumentCategory, PreferredContact } from "@/server/types";

function clientInput(fd: FormData): ClientInput {
  return {
    full_name: str(fd, "full_name"),
    email: strOrNull(fd, "email"),
    phone: strOrNull(fd, "phone"),
    address_line1: strOrNull(fd, "address_line1"),
    address_line2: strOrNull(fd, "address_line2"),
    city: strOrNull(fd, "city"),
    state: strOrNull(fd, "state"),
    postal_code: strOrNull(fd, "postal_code"),
    country: str(fd, "country") || "US",
    preferred_contact: (str(fd, "preferred_contact") || "email") as PreferredContact,
    notes: str(fd, "notes"),
    tags: str(fd, "tags"),
    is_test_record: bool(fd, "is_test_record"),
  };
}

function caseInput(fd: FormData): CaseInput {
  return {
    title: str(fd, "title"),
    category: str(fd, "category"),
    description: str(fd, "description"),
    organization: str(fd, "organization"),
    account_last4: strOrNull(fd, "account_last4"),
    status: (str(fd, "status") || "open") as CaseStatus,
    next_action: str(fd, "next_action"),
    reminder_date: strOrNull(fd, "reminder_date"),
    acting_for_another: bool(fd, "acting_for_another"),
    authorization_on_file: bool(fd, "authorization_on_file"),
    authorization_notes: str(fd, "authorization_notes"),
    outcome: str(fd, "outcome"),
  };
}

export async function createClientAction(_p: ActionState, fd: FormData) {
  return act("client.create", async (ctx) => {
    const row = await createClient(ctx, clientInput(fd));
    return { redirectTo: `/clients/${row.id}?created=1` };
  });
}

export async function updateClientAction(_p: ActionState, fd: FormData) {
  return act("client.update", async (ctx) => {
    const id = str(fd, "id");
    await updateClient(ctx, id, clientInput(fd));
    return { redirectTo: `/clients/${id}` };
  });
}

export async function archiveClientAction(_p: ActionState, fd: FormData) {
  return act("client.archive", async (ctx) => {
    const archived = str(fd, "archived") === "true";
    await setClientArchived(ctx, str(fd, "id"), archived);
    return { message: archived ? "Client archived." : "Client restored." };
  });
}

export async function deleteClientAction(_p: ActionState, fd: FormData) {
  return act(
    "client.delete",
    async (ctx) => {
      if (!bool(fd, "understand")) throw new UserError("Tick the box to confirm you understand deletion is permanent.");
      await deleteClient(ctx, str(fd, "id"), str(fd, "confirm_name"));
      return { redirectTo: "/clients?deleted=1" };
    },
    { limit: 10 },
  );
}

export async function createCaseAction(_p: ActionState, fd: FormData) {
  return act("case.create", async (ctx) => {
    const clientId = str(fd, "client_id");
    const row = await createCase(ctx, clientId, caseInput(fd));
    return { redirectTo: `/clients/${clientId}?tab=cases#case-${row.id}` };
  });
}

export async function updateCaseAction(_p: ActionState, fd: FormData) {
  return act("case.update", async (ctx) => {
    const row = await updateCase(ctx, str(fd, "id"), caseInput(fd));
    return { redirectTo: `/clients/${row.client_id}?tab=cases#case-${row.id}` };
  });
}

export async function addNoteAction(_p: ActionState, fd: FormData) {
  return act("note.add", async (ctx) => {
    await addNote(ctx, str(fd, "client_id"), {
      body: str(fd, "body"),
      case_id: strOrNull(fd, "case_id"),
      session_date: strOrNull(fd, "session_date"),
    });
    return { message: "Note added." };
  });
}

export async function uploadDocumentAction(_p: ActionState, fd: FormData) {
  return act(
    "document.upload",
    async (ctx) => {
      const file = await fileFrom(fd, "file");
      if (!file) throw new UserError("Choose a PDF, PNG or JPEG file.");
      const row = await uploadDocument(ctx, {
        client_id: str(fd, "client_id"),
        case_id: strOrNull(fd, "case_id"),
        category: (str(fd, "category") || "supporting_evidence") as DocumentCategory,
        description: str(fd, "description"),
        filename: file.filename,
        bytes: file.bytes,
        demo_fictional_ack: bool(fd, "demo_fictional_ack"),
      });
      const back = str(fd, "return_to");
      if (back.startsWith("/")) return { redirectTo: back };
      return { message: `Uploaded “${row.original_filename}”.` };
    },
    { limit: 30 },
  );
}

export async function deleteDocumentAction(_p: ActionState, fd: FormData) {
  return act("document.delete", async (ctx) => {
    if (!bool(fd, "confirm")) throw new UserError("Tick the confirmation box to delete this document.");
    await deleteDocument(ctx, str(fd, "id"));
    return { message: "Document deleted." };
  });
}
