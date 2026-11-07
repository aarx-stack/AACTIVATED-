import { PgBoss } from "pg-boss";
import { getEnv } from "@/lib/env";

let boss: Promise<PgBoss> | undefined;

/** Lazily started pg-boss client for enqueueing jobs from the web process. */
export function getQueue(): Promise<PgBoss> {
  if (!boss) {
    boss = (async () => {
      const instance = new PgBoss(getEnv().DATABASE_URL);
      instance.on("error", (error) => console.error("[queue] pg-boss error", error));
      await instance.start();
      return instance;
    })().catch((error) => {
      boss = undefined;
      throw error;
    });
  }
  return boss;
}

export async function enqueue(name: string, data: object) {
  const queue = await getQueue();
  await queue.createQueue(name);
  return queue.send(name, data);
}
