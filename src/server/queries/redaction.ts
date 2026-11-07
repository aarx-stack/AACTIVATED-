import { Role } from "@/generated/prisma/enums";

export interface FeedItem {
  message: string;
  department: { name: string; isConfidential: boolean } | null;
}

export const CONFIDENTIAL_PLACEHOLDER = "Completed confidential work (executive view only).";

/**
 * Legal, Finance and HR activity can contain confidential details.
 * Non-executives see that activity happened, never what it was.
 * Applied on the server so the text never reaches the browser.
 */
export function redactFeedItem<T extends FeedItem>(item: T, role: Role): T {
  if (role === Role.EXECUTIVE || !item.department?.isConfidential) return item;
  return { ...item, message: CONFIDENTIAL_PLACEHOLDER };
}
