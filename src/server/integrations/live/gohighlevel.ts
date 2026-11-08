/**
 * Live GoHighLevel adapter (HighLevel API v2, private integration token).
 * Off unless INTEGRATION_GOHIGHLEVEL=live and credentials are set. Outbound calls are still only
 * reached after assertDispatchable() has verified an approved, unmodified payload.
 *
 * Before switching this on, verify the request fields below against the current HighLevel API
 * reference with a sandbox location: field names on Social Planner posts change between versions.
 */
import { HealthStatus } from "@/generated/prisma/enums";
import { type GoHighLevelAdapter, IntegrationUnavailableError } from "../types";
import { callJson, type FetchLike, timed } from "./http";

export const GHL_BASE_URL = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";

export interface GoHighLevelConfig {
  token: string;
  /** The company's main location (sub-account). Reps use their own sub-account id. */
  locationId: string;
  /** Agency id, needed to list sub-accounts. */
  companyId?: string;
  fetch?: FetchLike;
}

const CHANNEL_PLATFORM: Record<string, string> = {
  FACEBOOK: "facebook",
  INSTAGRAM: "instagram",
  TIKTOK: "tiktok",
  YOUTUBE: "youtube",
};

/** Our channel -> HighLevel conversation message type (consented contacts only). */
const MESSAGE_TYPE: Record<string, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  INSTAGRAM: "IG",
  FACEBOOK: "FB",
};

export function createLiveGoHighLevel(config: GoHighLevelConfig): GoHighLevelAdapter {
  const headers = {
    Authorization: `Bearer ${config.token}`,
    Version: GHL_API_VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const call = <T>(path: string, init: RequestInit = {}) =>
    callJson<T>("GoHighLevel", `${GHL_BASE_URL}${path}`, { ...init, headers }, config.fetch);

  return {
    key: "GOHIGHLEVEL",
    mode: "live",

    async healthCheck() {
      try {
        const [, ms] = await timed(() =>
          call(`/locations/${encodeURIComponent(config.locationId)}`),
        );
        return { status: HealthStatus.OPERATIONAL, latencyMs: ms, message: "Connected (live)." };
      } catch (error) {
        return {
          status: HealthStatus.DOWN,
          latencyMs: 0,
          message: error instanceof Error ? error.message : "Unavailable.",
        };
      }
    },

    async listSubAccounts() {
      if (!config.companyId) {
        throw new IntegrationUnavailableError("Set GOHIGHLEVEL_COMPANY_ID to list sub-accounts.");
      }
      const data = await call<{ locations?: { id: string; name: string }[] }>(
        `/locations/search?companyId=${encodeURIComponent(config.companyId)}&limit=100`,
      );
      return (data.locations ?? []).map((l) => ({ id: l.id, name: l.name }));
    },

    async schedulePost(input) {
      const platform = CHANNEL_PLATFORM[input.channel];
      if (!platform) {
        throw new IntegrationUnavailableError(`GoHighLevel cannot post to ${input.channel}.`);
      }
      const location = encodeURIComponent(input.subAccountId);
      const accounts = await call<{
        results?: { accounts?: { id: string; platform: string }[] };
      }>(`/social-media-posting/${location}/accounts`);
      const account = accounts.results?.accounts?.find(
        (a) => a.platform?.toLowerCase() === platform,
      );
      if (!account) {
        throw new IntegrationUnavailableError(
          `No ${input.channel.toLowerCase()} account is connected in this GoHighLevel sub-account.`,
        );
      }
      const caption = [input.caption, input.hashtags.join(" ")].filter(Boolean).join("\n\n");
      const created = await call<{ results?: { post?: { _id?: string; id?: string } } }>(
        `/social-media-posting/${location}/posts`,
        {
          method: "POST",
          body: JSON.stringify({
            accountIds: [account.id],
            summary: caption,
            media: [],
            type: "post",
            status: "scheduled",
            scheduleDate: input.scheduledFor.toISOString(),
          }),
        },
      );
      const id = created.results?.post?._id ?? created.results?.post?.id;
      if (!id) throw new IntegrationUnavailableError("GoHighLevel did not confirm the post.");
      return { externalId: id };
    },

    async sendMessage(input) {
      const type = MESSAGE_TYPE[input.channel];
      if (!type) {
        throw new IntegrationUnavailableError(`GoHighLevel cannot send ${input.channel} messages.`);
      }
      const sent = await call<{ messageId?: string; conversationId?: string }>(
        "/conversations/messages",
        {
          method: "POST",
          body: JSON.stringify({
            type,
            contactId: input.contactId,
            message: input.message,
            ...(type === "Email"
              ? { subject: input.subject ?? "", html: input.html ?? input.message }
              : {}),
          }),
        },
      );
      if (!sent.messageId)
        throw new IntegrationUnavailableError("GoHighLevel did not confirm the message.");
      return { externalId: sent.messageId };
    },

    async listContacts(input) {
      const pageSize = Math.min(Math.max(input.pageSize ?? 100, 1), 100);
      const page = Math.max(input.page ?? 1, 1);
      const data = await call<{
        contacts?: {
          id: string;
          contactName?: string | null;
          firstName?: string | null;
          lastName?: string | null;
          email?: string | null;
          dnd?: boolean;
          dndSettings?: { Email?: { status?: string } };
        }[];
        total?: number;
      }>("/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          locationId: config.locationId,
          page,
          pageLimit: pageSize,
          filters: [{ field: "tags", operator: "contains", value: [input.tag] }],
        }),
      });
      const contacts = (data.contacts ?? []).map((c) => ({
        id: c.id,
        name:
          c.contactName?.trim() ||
          [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
          null,
        email: c.email?.trim() || null,
        emailDnd: Boolean(c.dnd) || c.dndSettings?.Email?.status === "active",
      }));
      const total = data.total ?? 0;
      return { contacts, hasMore: page * pageSize < total };
    },

    async setEmailDoNotDisturb(input) {
      await call(`/contacts/${encodeURIComponent(input.contactId)}`, {
        method: "PUT",
        body: JSON.stringify({
          dndSettings: {
            Email: { status: "active", message: "Unsubscribed from an AACTIVATED email." },
          },
        }),
      });
    },
  };
}
