import { AgentStatus } from "@/generated/prisma/enums";
import { runModel } from "@/lib/ai";
import { toStructuredOutputSchema } from "@/lib/ai/schema";
import type { ModelAdapter } from "@/lib/ai/types";
import type { DbClient } from "@/lib/db";
import { buildSystemPrompt, hasTool } from "./config";
import type { Skill } from "./skills";

export class AgentUnavailableError extends Error {
  readonly status = 409;
}

export class SkillOutputError extends Error {
  readonly status = 502;
}

export interface RunnableAgent {
  id: string;
  name: string;
  title: string;
  status: AgentStatus;
  config: unknown;
  departmentId: string | null;
}

/** Agents that are paused, in error or offline do not take work. */
export const WORKING_STATUSES: readonly AgentStatus[] = [AgentStatus.ACTIVE, AgentStatus.IDLE];

export async function runSkill<I, O>(
  skill: Skill<I, O>,
  agent: RunnableAgent,
  input: I,
  options: { purpose: string; client?: DbClient; adapter?: ModelAdapter },
): Promise<{ output: O; costUsd: number; model: string; provider: string }> {
  if (!WORKING_STATUSES.includes(agent.status)) {
    throw new AgentUnavailableError(
      `${agent.title} (${agent.name}) is ${agent.status.toLowerCase()} and cannot take work.`,
    );
  }
  if (!hasTool(agent.config, skill.requiresTool)) {
    throw new AgentUnavailableError(
      `${agent.title} is not allowed to use "${skill.requiresTool}".`,
    );
  }

  const result = await runModel(
    {
      tier: skill.tier,
      purpose: options.purpose,
      agentId: agent.id,
      departmentId: agent.departmentId,
      system: `${buildSystemPrompt(agent)}\n\nReply with a single JSON object that matches the required schema.`,
      messages: [{ role: "user", content: skill.prompt(input) }],
      jsonSchema: toStructuredOutputSchema(skill.output),
      mockOutput: skill.mock(input),
      maxTokens: 8000,
    },
    { client: options.client, adapter: options.adapter },
  );

  if (result.refused) throw new SkillOutputError(`${agent.title} declined this task.`);
  let json: unknown;
  try {
    json = JSON.parse(result.text);
  } catch {
    throw new SkillOutputError(`${agent.title} returned output that was not valid JSON.`);
  }
  const parsed = skill.output.safeParse(json);
  if (!parsed.success) {
    throw new SkillOutputError(
      `${agent.title} returned output that failed validation: ${parsed.error.issues[0]?.message}`,
    );
  }
  return {
    output: parsed.data,
    costUsd: result.costUsd,
    model: result.model,
    provider: result.provider,
  };
}
