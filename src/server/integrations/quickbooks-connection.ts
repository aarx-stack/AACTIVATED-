/**
 * "Connect QuickBooks": the OAuth 2.0 authorization-code flow, encrypted token storage and
 * automatic renewal. Plain fetch, no SDK.
 *
 * - Connecting is done once by a system admin or executive (integrations.connect_accounting).
 * - Tokens are encrypted with TOKEN_ENCRYPTION_KEY and never leave the server, the UI or the
 *   audit log.
 * - Access tokens last about an hour. They are renewed shortly before they expire, under a row
 *   lock so two requests never both spend the (single-use, rotating) refresh token.
 * - The app only ever reads from QuickBooks (see live/quickbooks.ts). Intuit has no read-only
 *   scope, so read-only is enforced in code: the adapter issues GET requests only.
 */
import { randomBytes } from "node:crypto";
import { NotificationKind, Role } from "@/generated/prisma/enums";
import { db, type DbClient } from "@/lib/db";
import { type Env, getEnv } from "@/lib/env";
import { recordAudit } from "@/server/audit/audit";
import { type Actor, authorize } from "@/server/authz/permissions";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "@/server/crypto/secrets";
import { callJson, type FetchLike } from "./live/http";
import { IntegrationUnavailableError } from "./types";

export const QB_OAUTH = {
  authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
  tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  scope: "com.intuit.quickbooks.accounting",
} as const;

/** Renew this long before the access token expires. */
const RENEW_MARGIN_MS = 5 * 60_000;
export const STATE_COOKIE = "qb_oauth_state";

export function quickBooksRedirectUri(env: Env = getEnv()) {
  return new URL("/api/integrations/quickbooks/callback", env.APP_URL).toString();
}

/** The OAuth app is configured (client id, secret and an encryption key). Names only. */
export function oauthMissing(env: Env = getEnv()): string[] {
  return (
    ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"] as const
  ).filter((name) => !env[name]);
}

export function oauthConfigured(env: Env = getEnv()) {
  return oauthMissing(env).length === 0;
}

export function newOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function buildAuthorizeUrl(state: string, env: Env = getEnv()) {
  const url = new URL(QB_OAUTH.authorizeUrl);
  url.searchParams.set("client_id", env.QUICKBOOKS_CLIENT_ID ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QB_OAUTH.scope);
  url.searchParams.set("redirect_uri", quickBooksRedirectUri(env));
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

function basicAuth(env: Env) {
  return `Basic ${Buffer.from(`${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64")}`;
}

async function tokenRequest(
  params: Record<string, string>,
  env: Env,
  fetchImpl?: FetchLike,
  now = new Date(),
): Promise<TokenSet> {
  const data = await callJson<TokenResponse>(
    "QuickBooks sign-in",
    QB_OAUTH.tokenUrl,
    {
      method: "POST",
      headers: {
        Authorization: basicAuth(env),
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    },
    fetchImpl,
  );
  if (!data.access_token || !data.refresh_token) {
    throw new IntegrationUnavailableError("QuickBooks sign-in returned an incomplete answer.");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: new Date(now.getTime() + (data.expires_in ?? 3600) * 1000),
    refreshExpiresAt: new Date(
      now.getTime() + (data.x_refresh_token_expires_in ?? 100 * 86_400) * 1000,
    ),
  };
}

export function exchangeCode(code: string, env: Env = getEnv(), fetchImpl?: FetchLike) {
  return tokenRequest(
    { grant_type: "authorization_code", code, redirect_uri: quickBooksRedirectUri(env) },
    env,
    fetchImpl,
  );
}

export function refreshTokens(refreshToken: string, env: Env = getEnv(), fetchImpl?: FetchLike) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, env, fetchImpl);
}

function sealed(tokens: TokenSet, env: Env) {
  const key = parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
  return {
    accessTokenEnc: encryptSecret(tokens.accessToken, key),
    refreshTokenEnc: encryptSecret(tokens.refreshToken, key),
    accessExpiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  };
}

/** Saves a new connection after the OAuth callback. Audited; executives are told. */
export async function saveConnection(
  actor: Actor,
  realmId: string,
  tokens: TokenSet,
  options: { env?: Env; client?: DbClient } = {},
) {
  authorize(actor, "integrations.connect_accounting");
  const env = options.env ?? getEnv();
  const client = options.client ?? db;
  if (!/^\d{1,32}$/.test(realmId)) {
    throw new IntegrationUnavailableError("QuickBooks returned an unexpected company id.");
  }
  const data = { accountId: realmId, ...sealed(tokens, env) };
  await client.$transaction(async (tx) => {
    await tx.integrationConnection.upsert({
      where: { provider: "QUICKBOOKS" },
      create: { provider: "QUICKBOOKS", ...data, connectedById: actor.id },
      update: { ...data, connectedById: actor.id, connectedAt: new Date(), lastRefreshedAt: null },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "integration.connected",
      entityType: "Integration",
      entityId: "QUICKBOOKS",
      // Never the tokens: only which company was connected.
      after: {
        provider: "QUICKBOOKS",
        companyId: realmId,
        environment: env.QUICKBOOKS_ENVIRONMENT,
      },
    });
    const who = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    const executives = await tx.user.findMany({
      where: { role: Role.EXECUTIVE, status: "ACTIVE", id: { not: actor.id } },
      select: { id: true },
    });
    if (executives.length) {
      await tx.notification.createMany({
        data: executives.map((u) => ({
          userId: u.id,
          kind: NotificationKind.SYSTEM,
          title: "QuickBooks connected",
          body: `${who?.name ?? "An administrator"} connected QuickBooks (read-only).`,
          href: "/admin",
        })),
      });
    }
  });
}

export async function getConnectionInfo(client: DbClient = db) {
  const row = await client.integrationConnection.findUnique({
    where: { provider: "QUICKBOOKS" },
    select: {
      accountId: true,
      connectedAt: true,
      lastRefreshedAt: true,
      refreshExpiresAt: true,
      connectedById: true,
    },
  });
  if (!row) return null;
  const by = row.connectedById
    ? await client.user.findUnique({ where: { id: row.connectedById }, select: { name: true } })
    : null;
  return { ...row, connectedByName: by?.name ?? null };
}

/**
 * A valid access token for the connected company, renewing it first when it is about to
 * expire. Throws IntegrationUnavailableError (readable) when not connected or when QuickBooks
 * refuses the renewal (the connection then has to be made again).
 */
export async function getQuickBooksAccess(
  options: { env?: Env; client?: typeof db; fetch?: FetchLike; now?: () => Date } = {},
): Promise<{ realmId: string; accessToken: string }> {
  const env = options.env ?? getEnv();
  const client = options.client ?? db;
  const now = options.now ?? (() => new Date());
  const key = parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY);

  const row = await client.integrationConnection.findUnique({ where: { provider: "QUICKBOOKS" } });
  if (!row) {
    throw new IntegrationUnavailableError(
      "QuickBooks is not connected. A system admin or executive can connect it in Admin.",
    );
  }
  if (row.accessExpiresAt.getTime() - RENEW_MARGIN_MS > now().getTime()) {
    return { realmId: row.accountId, accessToken: decryptSecret(row.accessTokenEnc, key) };
  }

  // Renew under a row lock: refresh tokens rotate, so only one request may spend it.
  return client.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IntegrationConnection" WHERE provider = 'QUICKBOOKS' FOR UPDATE`;
      const current = await tx.integrationConnection.findUnique({
        where: { provider: "QUICKBOOKS" },
      });
      if (!current) throw new IntegrationUnavailableError("QuickBooks is not connected.");
      if (current.accessExpiresAt.getTime() - RENEW_MARGIN_MS > now().getTime()) {
        // Another request renewed it while we waited.
        return {
          realmId: current.accountId,
          accessToken: decryptSecret(current.accessTokenEnc, key),
        };
      }
      if (current.refreshExpiresAt.getTime() <= now().getTime()) {
        throw new IntegrationUnavailableError(
          "The QuickBooks connection has expired. Connect QuickBooks again in Admin.",
        );
      }
      let tokens: TokenSet;
      try {
        tokens = await refreshTokens(
          decryptSecret(current.refreshTokenEnc, key),
          env,
          options.fetch,
        );
      } catch (error) {
        if (
          error instanceof IntegrationUnavailableError &&
          (error.httpStatus === 400 || error.httpStatus === 401)
        ) {
          throw new IntegrationUnavailableError(
            "QuickBooks refused to renew access. Connect QuickBooks again in Admin.",
            error.httpStatus,
          );
        }
        throw error;
      }
      await tx.integrationConnection.update({
        where: { provider: "QUICKBOOKS" },
        data: { ...sealed(tokens, env), lastRefreshedAt: now() },
      });
      return { realmId: current.accountId, accessToken: tokens.accessToken };
    },
    { timeout: 20_000 },
  );
}

/**
 * Disconnects: asks Intuit to revoke the token (best effort), then deletes it here. Even if
 * Intuit cannot be reached, nothing stays stored on our side.
 */
export async function disconnectQuickBooks(
  actor: Actor,
  options: { env?: Env; client?: typeof db; fetch?: FetchLike } = {},
) {
  authorize(actor, "integrations.connect_accounting");
  const env = options.env ?? getEnv();
  const client = options.client ?? db;
  const row = await client.integrationConnection.findUnique({ where: { provider: "QUICKBOOKS" } });
  if (!row) return { revoked: false, wasConnected: false };

  let revoked = false;
  try {
    const key = parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
    await callJson(
      "QuickBooks",
      QB_OAUTH.revokeUrl,
      {
        method: "POST",
        headers: {
          Authorization: basicAuth(env),
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: decryptSecret(row.refreshTokenEnc, key) }),
      },
      options.fetch,
    );
    revoked = true;
  } catch {
    revoked = false;
  }

  await client.$transaction(async (tx) => {
    await tx.integrationConnection.delete({ where: { provider: "QUICKBOOKS" } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "integration.disconnected",
      entityType: "Integration",
      entityId: "QUICKBOOKS",
      before: { provider: "QUICKBOOKS", companyId: row.accountId },
      metadata: { revokedAtIntuit: revoked },
    });
  });
  return { revoked, wasConnected: true };
}
