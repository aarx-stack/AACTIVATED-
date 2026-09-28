// Supabase Edge Function: sellavi-order
//
// Receives "new order" webhooks (Sellavi or any store platform) and creates
// a task on the AACTIVATED RX Task Scoreboard:
//   - idempotent per order (duplicate/retried webhooks never make two tasks)
//   - claims the next ticket number atomically via next_ticket()
//   - optionally announces the order in Slack (#task_board)
//
// Deploy in the Supabase dashboard (Edge Functions → Deploy new function,
// name it "sellavi-order", paste this file) with "Verify JWT" turned OFF —
// the store platform can't send Supabase auth headers. Access is instead
// gated by a secret key in the URL.
//
// Secrets to set (Edge Functions → Secrets):
//   HOOK_KEY           required — shared secret; callers must pass ?key=<value>
//   SLACK_WEBHOOK_URL  optional — Slack Incoming Webhook for order announcements
//   ORDER_CATEGORY     optional — new | medium | hot (default: new)
//   ORDER_ASSIGNEE     optional — JG | IM | GG (default: unassigned)
//
// Webhook URL to give the store platform:
//   https://<project-ref>.functions.supabase.co/sellavi-order?key=<HOOK_KEY>

type Json = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const HOOK_KEY = Deno.env.get("HOOK_KEY") ?? "";
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";
const ORDER_CATEGORY = (Deno.env.get("ORDER_CATEGORY") ?? "new").toLowerCase();
const ORDER_ASSIGNEE = (Deno.env.get("ORDER_ASSIGNEE") ?? "").toUpperCase();

const CATEGORY = ["new", "medium", "hot"].includes(ORDER_CATEGORY) ? ORDER_CATEGORY : "new";

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** Dig the first non-empty value out of a payload by candidate paths. */
function pick(obj: Json, paths: string[]): unknown {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const part of path.split(".")) {
      if (cur && typeof cur === "object" && part in (cur as Json)) {
        cur = (cur as Json)[part];
      } else {
        cur = undefined;
        break;
      }
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}

function asText(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

/** Map an arbitrary order payload to the fields the task needs. */
function mapOrder(payload: Json) {
  // Many platforms nest the order under a key.
  const order = ((pick(payload, ["order", "data.order", "data", "payload"]) as Json) ??
    payload) as Json;

  const ref = asText(
    pick(order, [
      "order_number",
      "orderNumber",
      "number",
      "order_id",
      "orderId",
      "reference",
      "ref",
      "id",
    ]),
  );
  const customer = asText(
    pick(order, [
      "customer_name",
      "customerName",
      "customer.name",
      "customer.full_name",
      "customer.fullName",
      "billing.name",
      "billing_address.name",
      "shipping.name",
      "client.name",
      "customer.email",
      "email",
    ]),
  );
  const total = asText(pick(order, ["total", "total_price", "totalPrice", "amount", "grand_total", "sum"]));
  const currency = asText(pick(order, ["currency", "currency_code", "currencyCode"]));

  const lines: string[] = [];
  const items = pick(order, ["items", "line_items", "lineItems", "products", "cart.items"]);
  if (Array.isArray(items)) {
    for (const raw of items.slice(0, 12)) {
      const item = (raw ?? {}) as Json;
      const name = asText(pick(item, ["name", "title", "product_name", "productName", "sku"]));
      const qty = asText(pick(item, ["quantity", "qty", "count"])) || "1";
      if (name) lines.push(`• ${qty} × ${name}`);
    }
  }
  if (total) lines.push(`Total: ${total}${currency ? ` ${currency}` : ""}`);
  if (customer) lines.push(`Customer: ${customer}`);
  lines.push("Source: Sellavi order webhook");

  return { ref, customer, total, currency, notes: lines.join("\n") };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }
  if (!HOOK_KEY || url.searchParams.get("key") !== HOOK_KEY) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: Json = {};
  try {
    payload = (await req.json()) as Json;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "body must be JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const order = mapOrder(payload);
  // Idempotency: one task per order, even if the webhook retries. Without a
  // usable order reference, fall back to a hash of the payload.
  const orderRef =
    order.ref ||
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload))),
      ),
    )
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const taskId = `sellavi-${orderRef}`.slice(0, 120);

  // Already have this order? Done (this is the webhook-retry path).
  const existing = await rest(`/tasks?id=eq.${encodeURIComponent(taskId)}&select=id`);
  if (existing.ok && ((await existing.json()) as unknown[]).length > 0) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Claim the ticket number (atomic UPDATE … RETURNING in Postgres).
  let ticketNumber = 0;
  const rpc = await rest(`/rpc/next_ticket`, { method: "POST", body: JSON.stringify({ p_floor: 1001 }) });
  if (rpc.ok) ticketNumber = Number(await rpc.json());
  if (!Number.isInteger(ticketNumber) || ticketNumber < 1001) {
    return new Response(JSON.stringify({ ok: false, error: "ticket claim failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const title = `New order${order.ref ? ` #${order.ref}` : ""}${order.customer ? ` — ${order.customer}` : ""}`;
  const body = {
    id: taskId,
    ticketNumber,
    title: title.slice(0, 120),
    notes: order.notes.slice(0, 2000),
    status: CATEGORY,
    assignedTo: ["JG", "IM", "GG"].includes(ORDER_ASSIGNEE) ? ORDER_ASSIGNEE : null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    completedBy: null,
    timeSpentMinutes: null,
    shotId: null,
  };

  const insert = await rest(`/tasks?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ id: taskId, body }]),
  });
  if (!insert.ok) {
    return new Response(JSON.stringify({ ok: false, error: `insert failed (${insert.status})` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Announce in Slack (best effort — the task is already saved).
  if (SLACK_WEBHOOK_URL) {
    const money = order.total ? ` · ${order.total}${order.currency ? ` ${order.currency}` : ""}` : "";
    try {
      await fetch(SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `🛒 *New order${order.ref ? ` #${order.ref}` : ""}*${order.customer ? ` — ${order.customer}` : ""}${money}\nAdded to the board as task *#${ticketNumber}* (${CATEGORY.toUpperCase()})`,
        }),
      });
    } catch {
      // never fail the webhook over Slack
    }
  }

  return new Response(JSON.stringify({ ok: true, ticketNumber, taskId }), {
    headers: { "Content-Type": "application/json" },
  });
});
