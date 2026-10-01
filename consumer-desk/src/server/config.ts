// Runtime configuration and the server-enforced mailing policy.
//
// Everything here is a pure function of an environment object so the rules can be unit tested.
// Unknown or contradictory values FAIL CLOSED: submissions are blocked and the header shows
// "MISCONFIGURED" rather than silently falling back to another mode.

export type DataMode = "demo" | "supabase";
export type AppMailMode = "mock" | "provider_test" | "live";

export interface EnvLike {
  [key: string]: string | undefined;
}

export interface AppConfig {
  dataMode: DataMode | "invalid";
  mailMode: AppMailMode | "invalid";
  liveMailingEnabled: boolean;
  ownerEmail: string | null;
  requireMfa: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  isProductionBuild: boolean;
  isVercel: boolean;
  demoAllowProductionBuild: boolean;
  letterstream: {
    test: LetterStreamCredentialPresence;
    live: LetterStreamCredentialPresence;
    documentationVersion: string | null;
  };
  problems: string[];
}

export interface LetterStreamCredentialPresence {
  apiIdPresent: boolean;
  apiKeyPresent: boolean;
  baseUrlPresent: boolean;
}

function flag(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function readConfig(env: EnvLike = process.env): AppConfig {
  const problems: string[] = [];

  const rawData = (env.DATA_MODE ?? "demo").trim().toLowerCase();
  const dataMode: AppConfig["dataMode"] =
    rawData === "demo" || rawData === "supabase" ? rawData : "invalid";
  if (dataMode === "invalid") problems.push(`DATA_MODE "${rawData}" is not "demo" or "supabase".`);

  const rawMail = (env.MAIL_MODE ?? "mock").trim().toLowerCase();
  const mailMode: AppConfig["mailMode"] =
    rawMail === "mock" || rawMail === "provider_test" || rawMail === "live" ? rawMail : "invalid";
  if (mailMode === "invalid") problems.push(`MAIL_MODE "${rawMail}" is not mock, provider_test or live.`);

  const supabaseUrl = present(env.SUPABASE_URL) ? env.SUPABASE_URL!.trim() : null;
  const supabaseAnonKey = present(env.SUPABASE_ANON_KEY)
    ? env.SUPABASE_ANON_KEY!.trim()
    : null;
  const ownerEmail = present(env.OWNER_EMAIL) ? env.OWNER_EMAIL!.trim().toLowerCase() : null;

  if (dataMode === "supabase") {
    if (!supabaseUrl) problems.push("SUPABASE_URL is required when DATA_MODE=supabase.");
    if (!supabaseAnonKey) problems.push("SUPABASE_ANON_KEY is required when DATA_MODE=supabase.");
    if (!ownerEmail) problems.push("OWNER_EMAIL is required when DATA_MODE=supabase.");
  }

  const cred = (prefix: string): LetterStreamCredentialPresence => ({
    apiIdPresent: present(env[`${prefix}_API_ID`]),
    apiKeyPresent: present(env[`${prefix}_API_KEY`]),
    baseUrlPresent: present(env[`${prefix}_BASE_URL`]),
  });

  return {
    dataMode,
    mailMode,
    liveMailingEnabled: flag(env.LIVE_MAILING_ENABLED),
    ownerEmail,
    requireMfa: flag(env.REQUIRE_MFA),
    supabaseUrl,
    supabaseAnonKey,
    isProductionBuild: env.NODE_ENV === "production",
    isVercel: present(env.VERCEL),
    demoAllowProductionBuild: flag(env.DEMO_ALLOW_PRODUCTION_BUILD),
    letterstream: {
      test: cred("LETTERSTREAM_TEST"),
      live: cred("LETTERSTREAM_LIVE"),
      documentationVersion: present(env.LETTERSTREAM_DOCS_VERSION) ? env.LETTERSTREAM_DOCS_VERSION!.trim() : null,
    },
    problems,
  };
}

export type ModeIndicator = "DEMO" | "MOCK" | "PROVIDER TEST" | "LIVE" | "MISCONFIGURED";

export interface MailPolicy {
  indicator: ModeIndicator;
  /** Human readable label for the header badge. */
  label: string;
  /** Which provider implementation handles submissions, if any. */
  provider: "mock" | "letterstream" | "none";
  /** The mail_mode written on mailing records. */
  recordMode: "mock" | "provider_test" | "live" | null;
  canSubmit: boolean;
  blockedReason: string | null;
  /** True when a submission could create a physical mailing or a charge. */
  mayCreateRealMail: boolean;
}

/**
 * The single source of truth for whether the server may submit mail, and to whom.
 * Called on every submission (not just when rendering the UI).
 */
export function resolveMailPolicy(config: AppConfig): MailPolicy {
  if (config.dataMode === "invalid" || config.mailMode === "invalid") {
    return blocked("MISCONFIGURED", "Configuration error", config.problems.join(" ") || "Invalid mode configuration.");
  }

  if (config.dataMode === "demo") {
    if (config.mailMode !== "mock") {
      return blocked(
        "MISCONFIGURED",
        "Demo data + non-mock mail (blocked)",
        "Demo data can only use the mock mailing provider. Set MAIL_MODE=mock or switch DATA_MODE to supabase.",
      );
    }
    return {
      indicator: "DEMO",
      label: "DEMO DATA · MOCK MAIL",
      provider: "mock",
      recordMode: "mock",
      canSubmit: true,
      blockedReason: null,
      mayCreateRealMail: false,
    };
  }

  if (config.problems.length > 0) {
    return blocked("MISCONFIGURED", "Configuration error", config.problems.join(" "));
  }

  switch (config.mailMode) {
    case "mock":
      return {
        indicator: "MOCK",
        label: "MOCK MAIL · SIMULATED ONLY",
        provider: "mock",
        recordMode: "mock",
        canSubmit: true,
        blockedReason: null,
        mayCreateRealMail: false,
      };
    case "provider_test":
      return {
        indicator: "PROVIDER TEST",
        label: "LETTERSTREAM PROVIDER TEST",
        provider: "letterstream",
        recordMode: "provider_test",
        canSubmit: true,
        blockedReason: null,
        // LetterStream's test behaviour is not documented publicly; assume it may create mail.
        mayCreateRealMail: true,
      };
    case "live":
      if (!config.liveMailingEnabled) {
        return {
          ...blocked(
            "LIVE",
            "LIVE MODE · SENDING DISABLED",
            "MAIL_MODE=live but LIVE_MAILING_ENABLED is not true. Live submissions are blocked on the server.",
          ),
          provider: "letterstream",
          recordMode: "live",
        };
      }
      return {
        indicator: "LIVE",
        label: "LIVE MAIL · REAL CHARGES",
        provider: "letterstream",
        recordMode: "live",
        canSubmit: true,
        blockedReason: null,
        mayCreateRealMail: true,
      };
  }
}

function blocked(indicator: ModeIndicator, label: string, reason: string): MailPolicy {
  return {
    indicator,
    label,
    provider: "none",
    recordMode: null,
    canSubmit: false,
    blockedReason: reason,
    mayCreateRealMail: false,
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function hostnameOf(hostHeader: string | null | undefined): string {
  if (!hostHeader) return "";
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

/**
 * The demo sign-in shortcut exists only for local development. It fails closed:
 *  - never when DATA_MODE is not demo,
 *  - never on Vercel,
 *  - never from a non-loopback Host,
 *  - never in a production build unless DEMO_ALLOW_PRODUCTION_BUILD=true (used only for local
 *    end-to-end tests of the production build).
 */
export function demoLoginAllowed(config: AppConfig, hostHeader: string | null | undefined): boolean {
  if (config.dataMode !== "demo") return false;
  if (config.isVercel) return false;
  if (!LOOPBACK_HOSTS.has(hostnameOf(hostHeader))) return false;
  if (config.isProductionBuild && !config.demoAllowProductionBuild) return false;
  return true;
}

let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (!cached || process.env.NODE_ENV === "test") cached = readConfig(process.env);
  return cached;
}
