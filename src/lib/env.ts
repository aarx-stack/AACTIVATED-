import { z } from "zod";

const boolish = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z
  .object({
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    /** Signs sessions. Checked for strength in production. */
    AUTH_SECRET: z.string().optional(),
    EMAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
    EMAIL_SERVER: z.string().optional(),
    EMAIL_FROM: z.string().default("AACTIVATED AI Brain <no-reply@aactivated.test>"),
    DEMO_LOGIN_ENABLED: boolish,
    AI_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
    /** "inline" runs agent workflows in the request; "queue" hands them to the worker. */
    AGENT_EXECUTION: z.enum(["inline", "queue"]).default("inline"),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL_BRAIN: z.string().default("claude-opus-5-5"),
    ANTHROPIC_MODEL_AGENT: z.string().default("claude-sonnet-5-5"),
    INTEGRATION_GOHIGHLEVEL: z.enum(["mock", "live"]).default("mock"),
    INTEGRATION_QUICKBOOKS: z.enum(["mock", "live"]).default("mock"),
    INTEGRATION_SLACK: z.enum(["mock", "live"]).default("mock"),
    // Live credentials (secrets: set in the environment, never committed).
    GOHIGHLEVEL_API_KEY: z.string().optional(),
    GOHIGHLEVEL_LOCATION_ID: z.string().optional(),
    GOHIGHLEVEL_COMPANY_ID: z.string().optional(),
    QUICKBOOKS_REALM_ID: z.string().optional(),
    QUICKBOOKS_ACCESS_TOKEN: z.string().optional(),
    QUICKBOOKS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
    // "Connect QuickBooks" (OAuth 2.0): the Intuit app's client id and secret. With these set,
    // a system admin or executive connects once in Admin and access renews automatically.
    QUICKBOOKS_CLIENT_ID: z.string().optional(),
    QUICKBOOKS_CLIENT_SECRET: z.string().optional(),
    /** 32 random bytes, base64: encrypts stored OAuth tokens. */
    TOKEN_ENCRYPTION_KEY: z.string().optional(),
    SLACK_WEBHOOK_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === "production") {
      if (env.DEMO_LOGIN_ENABLED) {
        ctx.addIssue({
          code: "custom",
          path: ["DEMO_LOGIN_ENABLED"],
          message: "Demo login must never be enabled in production.",
        });
      }
      if (
        !env.AUTH_SECRET ||
        env.AUTH_SECRET.length < 32 ||
        env.AUTH_SECRET.startsWith("replace-me")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_SECRET"],
          message: "Set AUTH_SECRET to a long random value (npm run secret).",
        });
      }
      if (env.EMAIL_TRANSPORT !== "smtp") {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_TRANSPORT"],
          message: "Production must send sign-in emails (smtp), not print them to the log.",
        });
      }
      if (!env.APP_URL.startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "Production must be served over https.",
        });
      }
    }
    if (env.QUICKBOOKS_CLIENT_ID && !env.TOKEN_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["TOKEN_ENCRYPTION_KEY"],
        message: "TOKEN_ENCRYPTION_KEY is required to store the QuickBooks connection.",
      });
    }
    if (env.EMAIL_TRANSPORT === "smtp" && !env.EMAIL_SERVER) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_SERVER"],
        message: "EMAIL_SERVER is required for smtp.",
      });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed, validated server environment. Throws with a readable message on misconfiguration. */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && cached) return cached;
  // A production server must say which environment it is. Without this, a deploy that forgot
  // APP_ENV would count as "development" and skip every production safety check above.
  if (source.NODE_ENV === "production" && !source.APP_ENV) {
    throw new Error(
      "Invalid environment configuration:\n  - APP_ENV: set APP_ENV (production, staging or development).",
    );
  }
  // On Render the public address is provided as RENDER_EXTERNAL_URL.
  const withUrl =
    !source.APP_URL && source.RENDER_EXTERNAL_URL
      ? { ...source, APP_URL: source.RENDER_EXTERNAL_URL }
      : source;
  const parsed = schema.safeParse(withUrl);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  return getEnv(source as NodeJS.ProcessEnv);
}
