import { z } from "zod";

/** An agent's ROLE / CONTEXT / DAILY ROUTINE and the tools it may use. */
export const agentConfigSchema = z.object({
  role: z.string().min(1),
  context: z.string().min(1),
  dailyRoutine: z.string().min(1),
  toolsAllowed: z.array(z.string()).default([]),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export function readAgentConfig(json: unknown): AgentConfig {
  const parsed = agentConfigSchema.safeParse(json);
  return parsed.success
    ? parsed.data
    : {
        role: "Not configured.",
        context: "Not configured.",
        dailyRoutine: "Not configured.",
        toolsAllowed: [],
      };
}

const COMPANY_RULES = [
  "You work only on AACTIVATED RX company business.",
  "Never make medical or health claims. Never name specific peptides on social media; use branded stack names.",
  "Never contact anyone directly. Anything that leaves the company goes to the human Approval Queue.",
  "Lead generation uses consented inbound contacts only: no scraping, purchased lists, cold DMs, follows or comments.",
].join("\n- ");

export function buildSystemPrompt(agent: { name: string; title: string; config: unknown }): string {
  const c = readAgentConfig(agent.config);
  return [
    `You are ${agent.name}, the ${agent.title} at AACTIVATED RX.`,
    `## ROLE\n${c.role}`,
    `## CONTEXT\n${c.context}`,
    `## DAILY ROUTINE\n${c.dailyRoutine}`,
    `## TOOLS YOU MAY USE\n${c.toolsAllowed.length ? c.toolsAllowed.join(", ") : "none"}`,
    `## COMPANY RULES\n- ${COMPANY_RULES}`,
  ].join("\n\n");
}

export function hasTool(config: unknown, tool: string) {
  return readAgentConfig(config).toolsAllowed.includes(tool);
}
