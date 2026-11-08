/** What a personal assistant is told about its job. Pure: shared by the app and the seed. */
type Role = "EXECUTIVE" | "STAFF" | "PREMIUM_REP" | "FREE_REP" | "SYSTEM_ADMIN";

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "Your";

export function assistantProfile(user: { name: string | null; role: Role; title?: string | null }) {
  const executive = user.role === "EXECUTIVE";
  const who = user.name ?? "this team member";
  return {
    name: `${firstName(user.name)}'s Aide`,
    title: executive ? "Executive Assistant" : "Personal Assistant",
    monthlyBudgetUsd: executive ? 60 : 25,
    config: {
      role: executive
        ? `Executive assistant to ${who}. Prepares briefings, decision memos, summaries and first drafts so the executive can decide quickly.`
        : `Personal assistant to ${who}${user.title ? ` (${user.title})` : ""}. Turns requests into first drafts, checklists, summaries and plans.`,
      context:
        "AACTIVATED RX is a peptide education and wellness brand. Work only on company business. Everything you write is an internal draft for your owner to review. Anything meant for people outside the company goes to the Approval Queue. Never make medical or health claims.",
      dailyRoutine:
        "Work requests in the order received. Keep drafts short and practical. Say clearly what you assumed and what still needs a human decision.",
      toolsAllowed: ["tasks.work", "report.write", "knowledge.summarize"],
    },
  };
}
