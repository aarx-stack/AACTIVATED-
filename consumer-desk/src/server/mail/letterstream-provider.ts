import type {
  CapabilityKey,
  MailProvider,
  ProviderDescriptor,
  QuoteResult,
  StatusResult,
  SubmitResult,
  VerifyResult,
} from "./types";

/**
 * LetterStream adapter — INTENTIONALLY NOT IMPLEMENTED YET.
 *
 * What is publicly confirmed (https://www.letterstream.com/api/, read 2026-09-30):
 *  - API access is granted per account after emailing support; documentation is shared after
 *    approval and appears under "My Account".
 *  - Announced calls: send letters (single/batch), letters/postcards/Certified/Flats, price check,
 *    PDF proofs, mailing status, Certified tracing, Certified signature, return envelopes, paper colour.
 *  - Files are PDF documents plus CSV address files.
 *  - Jobs submitted by API are NOT processed until paid; accounts can be pre-funded.
 *  - Test access is enabled after approval (its behaviour is not publicly described).
 *
 * What is NOT public: endpoint URLs, authentication, request/response fields, status values,
 * webhook support, idempotency, cancellation, test-mode behaviour, and PDF/address layout rules.
 * Per the project rules none of these are guessed. Every operation below returns "blocked" and
 * sends no network request until the account documentation is supplied and implemented.
 */

export const LETTERSTREAM_PUBLIC_INFO_URL = "https://www.letterstream.com/api/";

const NOT_DOCUMENTED =
  "Announced on LetterStream's public API page, but the request format is only in the account's API documentation, which has not been supplied.";

const BLOCKED_MESSAGE =
  "LetterStream integration is awaiting your account's API documentation. No request was sent to LetterStream.";

export interface LetterStreamEnv {
  apiId?: string;
  apiKey?: string;
  baseUrl?: string;
}

export class LetterStreamProvider implements MailProvider {
  constructor(
    private readonly mode: "provider_test" | "live",
    private readonly env: LetterStreamEnv,
    private readonly dataMode: "demo" | "supabase",
  ) {
    if (dataMode === "demo") {
      // Fictional demo records must never reach a real provider.
      throw new Error("LetterStreamProvider cannot be constructed in demo data mode.");
    }
  }

  private missingEnv(): string[] {
    const prefix = this.mode === "live" ? "LETTERSTREAM_LIVE" : "LETTERSTREAM_TEST";
    const missing: string[] = [];
    if (!this.env.apiId) missing.push(`${prefix}_API_ID`);
    if (!this.env.apiKey) missing.push(`${prefix}_API_KEY`);
    if (!this.env.baseUrl) missing.push(`${prefix}_BASE_URL`);
    return missing;
  }

  descriptor(): ProviderDescriptor {
    const keys: CapabilityKey[] = [
      "verify_connection",
      "quote",
      "proof",
      "submit",
      "status",
      "tracking",
      "cancel",
      "idempotency",
    ];
    const capabilities = Object.fromEntries(
      keys.map((k) => [
        k,
        {
          supported: false,
          basis:
            k === "cancel" || k === "idempotency" || k === "verify_connection"
              ? "Not mentioned in LetterStream's public information; unknown until account documentation is reviewed."
              : NOT_DOCUMENTED,
        },
      ]),
    ) as ProviderDescriptor["capabilities"];

    return {
      id: "letterstream",
      displayName: this.mode === "live" ? "LetterStream (live)" : "LetterStream (provider test)",
      mode: this.mode,
      configured: this.missingEnv().length === 0,
      missingEnv: this.missingEnv(),
      implementationStatus: "awaiting_documentation",
      capabilities,
      services: [
        {
          value: "first_class",
          label: "First-Class",
          supported: false,
          supportsReturnReceipt: false,
          tracking: "unknown",
          note: "Offered by LetterStream; API parameters and account availability not yet confirmed.",
        },
        {
          value: "certified",
          label: "Certified",
          supported: false,
          supportsReturnReceipt: false,
          tracking: "unknown",
          note: "Offered by LetterStream; return-receipt option and API parameters not yet confirmed.",
        },
      ],
      mayCreateRealMail: true,
      notes: [
        "API documentation is issued by LetterStream after account approval (see My Account).",
        "Submitted jobs are not produced until paid; accepted is not the same as mailed.",
        "Test access behaviour is undocumented publicly — treat any test submission as possibly real and chargeable.",
      ],
    };
  }

  async verifyConnection(): Promise<VerifyResult> {
    return { kind: "blocked", message: BLOCKED_MESSAGE };
  }

  async quote(): Promise<QuoteResult> {
    return { kind: "unavailable", message: BLOCKED_MESSAGE };
  }

  async submit(): Promise<SubmitResult> {
    return { kind: "blocked", message: BLOCKED_MESSAGE };
  }

  async status(): Promise<StatusResult> {
    return { kind: "unavailable", message: BLOCKED_MESSAGE };
  }
}
