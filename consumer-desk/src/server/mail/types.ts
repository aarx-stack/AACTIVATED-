import type { Address, DeliveryStatus, MailOptions, MailingStatus } from "../types";

/**
 * Provider-neutral mailing interface. The application never talks to a mail provider except
 * through this contract, so a provider can be swapped or its real API wired in without touching
 * the rest of the app.
 */

export type CapabilityKey =
  | "verify_connection"
  | "quote"
  | "proof"
  | "submit"
  | "status"
  | "tracking"
  | "cancel"
  | "idempotency";

export interface Capability {
  supported: boolean;
  /** Where support was confirmed, e.g. "Simulated by mock provider" or a documentation section. */
  basis: string;
}

export interface ServiceOption {
  value: string;
  label: string;
  supported: boolean;
  supportsReturnReceipt: boolean;
  tracking: "available" | "not_available" | "unknown";
  note: string;
}

export interface ProviderDescriptor {
  id: "mock" | "letterstream";
  displayName: string;
  mode: "mock" | "provider_test" | "live";
  configured: boolean;
  /** Names (never values) of missing environment variables. */
  missingEnv: string[];
  /** True only after a documented, non-mailing verification call succeeded. */
  implementationStatus: "simulated" | "implemented" | "awaiting_documentation";
  capabilities: Record<CapabilityKey, Capability>;
  services: ServiceOption[];
  mayCreateRealMail: boolean;
  notes: string[];
}

export type MockSimulation = "accept" | "accept_awaiting_funding" | "reject" | "timeout";

export interface SubmitRequest {
  idempotencyKey: string;
  packetId: string;
  pdf: Uint8Array;
  pageCount: number;
  sender: Address;
  recipient: Address;
  options: MailOptions;
  /** Mock provider only; ignored by real providers. */
  simulate?: MockSimulation;
}

export type SubmitResult =
  | {
      kind: "accepted";
      providerReference: string;
      providerStatusRaw: string;
      awaitingFunding: boolean;
      trackingNumber: string | null;
      costCents: number | null;
      costCurrency: string | null;
    }
  /** Definitive rejection before acceptance: safe to record as failed (nothing was accepted). */
  | { kind: "rejected"; providerStatusRaw: string | null; message: string; httpStatus: number | null }
  /** The request may or may not have been accepted. Never resend automatically. */
  | { kind: "unknown"; message: string }
  /** The request was never sent (not configured / not implemented / policy). */
  | { kind: "blocked"; message: string };

export type QuoteResult =
  | { kind: "quote"; cents: number; currency: string; source: string }
  | { kind: "unavailable"; message: string };

export interface ProviderStatusEvent {
  providerStatusRaw: string;
  description: string;
  occurredAt: string | null;
}

export type StatusResult =
  | {
      kind: "status";
      providerStatusRaw: string;
      /** Only set when the provider's own report maps unambiguously; otherwise leave undefined. */
      mailingStatus?: MailingStatus;
      deliveryStatus?: DeliveryStatus;
      trackingNumber?: string | null;
      costCents?: number | null;
      events: ProviderStatusEvent[];
    }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string; retryable: boolean };

export type VerifyResult =
  | { kind: "ok"; message: string; simulated: boolean }
  | { kind: "failed"; message: string }
  | { kind: "blocked"; message: string };

export interface MailProvider {
  descriptor(): ProviderDescriptor;
  verifyConnection(): Promise<VerifyResult>;
  quote(req: Omit<SubmitRequest, "idempotencyKey" | "simulate">): Promise<QuoteResult>;
  submit(req: SubmitRequest): Promise<SubmitResult>;
  status(providerReference: string): Promise<StatusResult>;
}
