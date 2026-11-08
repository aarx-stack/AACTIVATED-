/**
 * Live Slack adapter: an incoming webhook for internal team alerts only.
 * The health check does not post (that would message the channel); it only confirms the
 * webhook is configured.
 */
import { HealthStatus } from "@/generated/prisma/enums";
import type { SlackAdapter } from "../types";
import { callJson, type FetchLike } from "./http";

export interface SlackConfig {
  webhookUrl: string;
  fetch?: FetchLike;
}

export function isSlackWebhookUrl(url: string) {
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url);
}

export function createLiveSlack(config: SlackConfig): SlackAdapter {
  return {
    key: "SLACK",
    mode: "live",
    async healthCheck() {
      return isSlackWebhookUrl(config.webhookUrl)
        ? {
            status: HealthStatus.OPERATIONAL,
            latencyMs: 0,
            message: "Webhook configured (live). Not pinged, to avoid posting.",
          }
        : {
            status: HealthStatus.DOWN,
            latencyMs: 0,
            message: "SLACK_WEBHOOK_URL is not a Slack webhook.",
          };
    },
    async notify(channel, text) {
      // Webhooks post to the channel they were created for; the label keeps context.
      await callJson(
        "Slack",
        config.webhookUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `*${channel}* ${text}` }),
          timeoutMs: 5_000,
        },
        config.fetch,
      );
      return { delivered: true };
    },
  };
}
