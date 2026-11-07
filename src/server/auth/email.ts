import nodemailer from "nodemailer";
import { getEnv } from "@/lib/env";

/** Delivers the magic link. "console" transport logs it instead of sending anything. */
export async function sendMagicLink({ to, url }: { to: string; url: string }) {
  const env = getEnv();
  if (env.EMAIL_TRANSPORT === "console") {
    console.info(`\n[auth] Magic sign-in link for ${to}:\n${url}\n`);
    return;
  }
  const transport = nodemailer.createTransport(env.EMAIL_SERVER);
  const { host } = new URL(url);
  await transport.sendMail({
    to,
    from: env.EMAIL_FROM,
    subject: "Your AACTIVATED AI Brain sign-in link",
    text: `Sign in to ${host}\n${url}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Sign in to <strong>AACTIVATED AI Brain</strong>.</p><p><a href="${url}">Sign in</a></p><p>If you did not request this, ignore this email.</p>`,
  });
}
