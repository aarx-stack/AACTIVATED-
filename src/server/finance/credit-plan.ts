import type { CreditCategory } from "@/generated/prisma/enums";

/** The standard plan. Generic best practice, not financial or legal advice. */
export const CREDIT_PLAN: {
  key: string;
  category: CreditCategory;
  title: string;
  description: string;
}[] = [
  {
    key: "entity",
    category: "FOUNDATION",
    title: "Business entity registered and in good standing",
    description:
      "The LLC or corporation is registered with the state and its annual filings are current.",
  },
  {
    key: "ein",
    category: "FOUNDATION",
    title: "EIN from the IRS",
    description: "The company's federal tax ID. Keep the number itself out of this app.",
  },
  {
    key: "bank",
    category: "FOUNDATION",
    title: "Business bank account",
    description: "A checking account in the exact legal business name, used for all company money.",
  },
  {
    key: "address-phone",
    category: "FOUNDATION",
    title: "Business address and phone",
    description:
      "A real business address and a business phone number, listed in the national directory (411).",
  },
  {
    key: "web",
    category: "FOUNDATION",
    title: "Website and domain email",
    description: "A professional website and email on the company domain, matching the legal name.",
  },
  {
    key: "licenses",
    category: "FOUNDATION",
    title: "Licenses and permits current",
    description: "Every business license and permit the company needs is active.",
  },
  {
    key: "duns",
    category: "BUREAUS",
    title: "D-U-N-S number from Dun & Bradstreet",
    description: "The free D-U-N-S number that opens the company's D&B file.",
  },
  {
    key: "experian",
    category: "BUREAUS",
    title: "Experian business profile checked",
    description: "The Experian business file exists and its details are correct.",
  },
  {
    key: "equifax",
    category: "BUREAUS",
    title: "Equifax business profile checked",
    description: "The Equifax business file exists and its details are correct.",
  },
  {
    key: "consistency",
    category: "BUREAUS",
    title: "Name, address and phone match everywhere",
    description:
      "Exactly the same details with the state, the IRS, the bank, the bureaus and online listings.",
  },
  {
    key: "vendors",
    category: "TRADELINES",
    title: "Three to five vendor accounts that report",
    description: "Net-30 accounts with suppliers that report payments to the business bureaus.",
  },
  {
    key: "pay-early",
    category: "TRADELINES",
    title: "Every account paid on time or early",
    description: "Payment history is the biggest factor in business credit scores.",
  },
  {
    key: "card",
    category: "TRADELINES",
    title: "Business credit card that reports",
    description: "A card in the company's name that reports to the business bureaus.",
  },
  {
    key: "utilization",
    category: "TRADELINES",
    title: "Balances kept low",
    description: "Keep revolving balances well under the limits (under 30% is a common guide).",
  },
  {
    key: "monitor",
    category: "MONITORING",
    title: "Reports checked every month",
    description: "Review the D&B, Experian and Equifax business reports monthly.",
  },
  {
    key: "disputes",
    category: "MONITORING",
    title: "Errors disputed",
    description: "Ask the bureau to correct anything wrong on a report.",
  },
  {
    key: "scores",
    category: "MONITORING",
    title: "Scores recorded monthly",
    description: "Record the scores here each month to see the trend.",
  },
  {
    key: "financing-ready",
    category: "MONITORING",
    title: "Ready for financing",
    description: "Check the FICO SBSS score and the documents lenders ask for before applying.",
  },
];
