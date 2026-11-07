import { randomUUID } from "node:crypto";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

export async function createUser(
  role: Role,
  overrides: { status?: "ACTIVE" | "SUSPENDED" | "INVITED" } = {},
) {
  const id = randomUUID().slice(0, 8);
  return db.user.create({
    data: {
      name: `${role} ${id}`,
      email: `${role.toLowerCase()}-${id}@example.test`,
      role,
      status: overrides.status ?? "ACTIVE",
    },
  });
}

export { db };
