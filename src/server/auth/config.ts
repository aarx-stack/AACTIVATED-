import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import { z } from "zod";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { recordAudit } from "@/server/audit/audit";
import { sendMagicLink } from "./email";

const env = getEnv();

/** No self-registration: only invited/active users already in the database may sign in. */
async function isAllowedEmail(email: string | null | undefined) {
  if (!email) return false;
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { status: true },
  });
  return Boolean(user && user.status !== "SUSPENDED");
}

const providers: NextAuthConfig["providers"] = [
  Nodemailer({
    server: env.EMAIL_SERVER ?? "smtp://localhost:1025",
    from: env.EMAIL_FROM,
    maxAge: 15 * 60,
    sendVerificationRequest: async ({ identifier, url }) => sendMagicLink({ to: identifier, url }),
  }),
];

if (env.DEMO_LOGIN_ENABLED) {
  // Development only (env validation refuses this when APP_ENV=production).
  providers.push(
    Credentials({
      id: "demo",
      name: "Demo user",
      credentials: { email: { label: "Email", type: "email" } },
      authorize: async (raw) => {
        const parsed = z.object({ email: z.string().email() }).safeParse(raw);
        if (!parsed.success) return null;
        const user = await db.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user || user.status === "SUSPENDED") return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );
}

export const authConfig = {
  adapter: PrismaAdapter(db as unknown as Parameters<typeof PrismaAdapter>[0]),
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  providers,
  pages: { signIn: "/login", verifyRequest: "/login/check-email", error: "/login" },
  callbacks: {
    // Runs on both the magic-link request and the link click.
    async signIn({ user }) {
      return isAllowedEmail(user.email);
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      if (!user.id) return;
      await db.user.update({
        where: { id: user.id },
        data: {
          lastActiveAt: new Date(),
          status: "ACTIVE",
          emailVerified: account?.provider === "nodemailer" ? new Date() : undefined,
        },
      });
      await recordAudit(db, {
        actor: { type: "USER", userId: user.id },
        action: "auth.sign_in",
        entityType: "User",
        entityId: user.id,
        metadata: { provider: account?.provider ?? "unknown" },
      });
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
