/** Queue names. Phase 2 adds agent-run and dispatch queues. */
export const QUEUES = {
  healthCheck: "system.health-check",
  heartbeat: "system.worker-heartbeat",
  contentWorkflow: "agents.content-workflow",
  promptTask: "agents.prompt-task",
} as const;
