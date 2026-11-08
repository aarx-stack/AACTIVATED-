/** Every page and who may open it. Written independently of the app's permission code. */
export const E = "guy";
export const S = "maya";
export const A = "isaac";
export const P = "jordan";
export const F = "sam";
export type Who = typeof E | typeof S | typeof A | typeof P | typeof F;
export const ALL: Who[] = [E, S, A, P, F];

export const PAGES: { path: string; heading: string; roles: Who[] }[] = [
  { path: "/command-center", heading: "Brain Command Center", roles: [E, S, A] },
  { path: "/team", heading: "Company Team", roles: [E, S, A] },
  { path: "/agents", heading: "Agent Workspace", roles: [E, S] },
  { path: "/approvals", heading: "Approval & Compliance Queue", roles: [E, S] },
  { path: "/approvals/rules", heading: "Content rules", roles: [E, S] },
  { path: "/content", heading: "Content Studio", roles: [E, S, P] },
  { path: "/content/new", heading: "New post", roles: [E, S, P] },
  { path: "/content/email", heading: "Email campaigns", roles: [E, S, P] },
  { path: "/content/email/new", heading: "New campaign", roles: [E, S, P] },
  { path: "/content/publishing", heading: "Publishing", roles: [E, S] },
  { path: "/content/publishing/new", heading: "New publication", roles: [E, S] },
  { path: "/my-team", heading: "My AI Team", roles: [P, F] },
  { path: "/back-office", heading: "Back Office — Earnings", roles: [P, F] },
  { path: "/finance", heading: "Finance & Budget", roles: [E] },
  { path: "/finance/transactions", heading: "Transactions", roles: [E] },
  { path: "/finance/credit", heading: "Credit Builder", roles: [E] },
  { path: "/budgets", heading: "Budgets", roles: [E, S] },
  { path: "/knowledge", heading: "Knowledge Library", roles: ALL },
  { path: "/knowledge/new", heading: "Add document", roles: [E, S] },
  { path: "/prompts", heading: "Prompt Generator", roles: [E, S] },
  { path: "/roadmap", heading: "Development & Tokenization Map", roles: [E, S, A] },
  { path: "/admin", heading: "Admin & Access Control", roles: [E, A] },
  { path: "/admin/audit", heading: "Audit Log", roles: [E, A] },
  { path: "/notifications", heading: "Notifications", roles: ALL },
  { path: "/settings", heading: "Settings", roles: ALL },
];

/** Detail pages, reached by following the first link on their list page. */
export const DETAILS: { list: string; link: string; roles: Who[] }[] = [
  { list: "/agents", link: "a[href^='/agents/']", roles: [E, S] },
  { list: "/approvals?tab=all", link: "a[href*='selected=']", roles: [E, S] },
  { list: "/knowledge", link: "a[href^='/knowledge/']:not([href='/knowledge/new'])", roles: ALL },
  {
    list: "/content/publishing",
    link: "a[href^='/content/publishing/']:not([href='/content/publishing/new'])",
    roles: [E, S],
  },
  {
    list: "/content/email",
    link: "a[href^='/content/email/']:not([href='/content/email/new'])",
    roles: [E, S, P],
  },
];
