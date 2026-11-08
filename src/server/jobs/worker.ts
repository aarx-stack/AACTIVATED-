/**
 * Background worker (separate long-running process: `npm run worker`).
 * Runs on pg-boss, which stores jobs in the same Postgres — no Redis needed.
 */
import "dotenv/config";
import { PgBoss } from "pg-boss";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { ContentChannel } from "@/generated/prisma/enums";
import { runContentWorkflow } from "@/server/agents/content-workflow";
import { runPromptTask } from "@/server/agents/task-work";
import { ensureMonthlyBudgets } from "@/server/budgets/service";
import { sendCampaign } from "@/server/email/campaigns";
import { getSystemHealth } from "@/server/health/health";
import { QUEUES } from "./queues";

async function main() {
  const env = getEnv();
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (error) => console.error("[worker] pg-boss error", error));
  await boss.start();

  for (const name of Object.values(QUEUES)) await boss.createQueue(name);

  await boss.work(QUEUES.heartbeat, async () => {
    await db.healthCheck.create({
      data: { component: "worker", status: "OPERATIONAL", message: "Heartbeat." },
    });
  });

  await boss.work(QUEUES.healthCheck, async () => {
    const health = await getSystemHealth({ persist: true });
    console.info(`[worker] health: ${health.status}`);
  });

  await boss.work<{ taskId: string; channel: ContentChannel }>(
    QUEUES.contentWorkflow,
    async (jobs) => {
      for (const job of jobs) {
        const result = await runContentWorkflow(job.data.taskId, job.data.channel);
        console.info(`[worker] content workflow ${job.data.taskId}: ${result.status}`);
      }
    },
  );

  await boss.work<{ taskId: string }>(QUEUES.promptTask, async (jobs) => {
    for (const job of jobs) {
      const result = await runPromptTask(job.data.taskId);
      console.info(`[worker] prompt task ${job.data.taskId}: ${result.status}`);
    }
  });

  await boss.work<{ campaignId: string; actorId: string }>(QUEUES.emailCampaign, async (jobs) => {
    for (const job of jobs) {
      const actor = await db.user.findUnique({
        where: { id: job.data.actorId },
        select: { id: true, role: true, status: true },
      });
      if (!actor) continue;
      const result = await sendCampaign(actor, job.data.campaignId);
      console.info(
        `[worker] email ${job.data.campaignId}: ${result.sent} sent, ${result.skipped} skipped`,
      );
    }
  });

  await boss.work(QUEUES.budgetRollover, async () => {
    const created = await ensureMonthlyBudgets();
    if (created.length)
      console.info(`[worker] started ${created.length} budgets for the new month`);
  });

  await boss.schedule(QUEUES.budgetRollover, "5 0 * * *");
  await boss.schedule(QUEUES.heartbeat, "* * * * *");
  await boss.schedule(QUEUES.healthCheck, "*/5 * * * *");
  await boss.send(QUEUES.heartbeat, {});
  await boss.send(QUEUES.healthCheck, {});

  console.info("[worker] started");

  const shutdown = async () => {
    console.info("[worker] stopping");
    await boss.stop({ graceful: true });
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[worker] failed to start", error);
  process.exit(1);
});
