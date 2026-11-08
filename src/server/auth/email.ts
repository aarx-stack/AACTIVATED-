import nodemailer from "nodemailer";
import { getEnv } from "@/lib/env";

/**
 * The link always points at APP_URL, whatever host the request arrived on. Auth.js builds the
 * link from the request's Host / X-Forwarded-Host, which a client can set; without this, an
 * attacker could get a real sign-in link for someone else emailed with their own domain in it.
 */
export function pinToAppUrl(url: string, appUrl = getEnv().APP_URL): string {
  const link = new URL(url);
  const app = new URL(appUrl);
  const base = app.pathname.replace(/\/$/, "");
  const path = link.pathname.startsWith(base) ? link.pathname.slice(base.length) : link.pathname;
  return new URL(`${base}${path}${link.search}`, app.origin).toString();
}

/** Delivers the magic link. "console" transport logs it instead of sending anything. */
export async function sendMagicLink({ to, url: rawUrl }: { to: string; url: string }) {
  const env = getEnv();
  const url = pinToAppUrl(rawUrl, env.APP_URL);
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
