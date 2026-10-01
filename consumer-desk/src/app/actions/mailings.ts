"use server";

import type { ActionState } from "@/lib/action-state";
import { act, bool, str, strOrNull } from "@/server/actions-helpers";
import type { MockSimulation } from "@/server/mail/types";
import {
  SIMULATED_EVENTS,
  reconcileUnknownSubmission,
  recordManualMailing,
  recordSimulatedEvent,
  refreshMailingStatus,
  submitMailing,
  updateManualMailing,
  type SimulatedEvent,
} from "@/server/services/mailings";
import { UserError } from "@/server/services/errors";
import type { DeliveryStatus, MailingStatus } from "@/server/types";

export async function submitMailingAction(_p: ActionState, fd: FormData) {
  return act(
    "mailing.submit",
    async (ctx) => {
      const simulate = str(fd, "simulate") as MockSimulation | "";
      const outcome = await submitMailing(ctx, {
        packetId: str(fd, "packet_id"),
        packetHash: str(fd, "packet_hash"),
        confirmFinal: bool(fd, "confirm_final"),
        acknowledgeCharges: bool(fd, "acknowledge_charges"),
        simulate: simulate ? simulate : undefined,
      });
      const back = str(fd, "return_to");
      const target = back.startsWith("/") ? back.replace(":mailing", outcome.mailing.id) : `/mailings/${outcome.mailing.id}`;
      return { redirectTo: `${target}${target.includes("?") ? "&" : "?"}outcome=${outcome.outcome}` };
    },
    { limit: 10 },
  );
}

export async function refreshStatusAction(_p: ActionState, fd: FormData) {
  return act(
    "mailing.refresh",
    async (ctx) => {
      const r = await refreshMailingStatus(ctx, str(fd, "mailing_id"));
      if (!r.ok) throw new UserError(r.message);
      return { message: r.message };
    },
    { limit: 30 },
  );
}

export async function simulateEventAction(_p: ActionState, fd: FormData) {
  return act("mailing.simulate", async (ctx) => {
    const event = str(fd, "event") as SimulatedEvent;
    await recordSimulatedEvent(ctx, str(fd, "mailing_id"), event);
    return { message: `Simulated event recorded: ${SIMULATED_EVENTS[event]?.label ?? event}.` };
  });
}

export async function reconcileAction(_p: ActionState, fd: FormData) {
  return act("mailing.reconcile", async (ctx) => {
    await reconcileUnknownSubmission(ctx, str(fd, "mailing_id"), {
      resolution: str(fd, "resolution") as "confirmed_accepted" | "confirmed_not_received",
      provider_reference: strOrNull(fd, "provider_reference"),
      notes: str(fd, "notes"),
    });
    return { message: "Reconciliation recorded." };
  });
}

export async function manualMailingAction(_p: ActionState, fd: FormData) {
  return act("mailing.manual", async (ctx) => {
    const m = await recordManualMailing(ctx, str(fd, "packet_id"), {
      service: str(fd, "service") === "certified" ? "certified" : "first_class",
      provider_label: str(fd, "provider_label"),
      external_reference: strOrNull(fd, "external_reference"),
      mailing_status: (str(fd, "mailing_status") || "mailed") as "accepted" | "processing" | "mailed",
      mailed_date: strOrNull(fd, "mailed_date"),
      tracking_number: strOrNull(fd, "tracking_number"),
      actual_cost: str(fd, "actual_cost"),
      notes: str(fd, "notes"),
    });
    return { redirectTo: `/mailings/${m.id}` };
  });
}

export async function manualUpdateAction(_p: ActionState, fd: FormData) {
  return act("mailing.manual_update", async (ctx) => {
    await updateManualMailing(ctx, str(fd, "mailing_id"), {
      mailing_status: (strOrNull(fd, "mailing_status") ?? undefined) as MailingStatus | undefined,
      delivery_status: (strOrNull(fd, "delivery_status") ?? undefined) as DeliveryStatus | undefined,
      tracking_number: strOrNull(fd, "tracking_number"),
      note: str(fd, "note"),
    });
    return { message: "Manual update recorded." };
  });
}
