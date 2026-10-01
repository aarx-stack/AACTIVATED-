import { randomBytes } from "node:crypto";
import type {
  MailProvider,
  ProviderDescriptor,
  QuoteResult,
  StatusResult,
  SubmitRequest,
  SubmitResult,
  VerifyResult,
} from "./types";

const SIM = "Simulated by the mock provider (no external request is made)";

/**
 * MOCK provider. Never contacts LetterStream or any other service and never creates mail.
 * Every result it produces is recorded as "simulated". It does not invent prices: quotes are
 * reported as unavailable. Status only changes when you explicitly record a simulated event.
 */
export class MockMailProvider implements MailProvider {
  descriptor(): ProviderDescriptor {
    return {
      id: "mock",
      displayName: "Mock mailing provider (simulation)",
      mode: "mock",
      configured: true,
      missingEnv: [],
      implementationStatus: "simulated",
      capabilities: {
        verify_connection: { supported: true, basis: SIM },
        quote: { supported: false, basis: "The mock provider does not price mail, so no quote is shown." },
        proof: { supported: false, basis: "Use the packet PDF preview; the mock provider has no proofs." },
        submit: { supported: true, basis: SIM },
        status: { supported: true, basis: `${SIM}. Status changes only when you record a simulated event.` },
        tracking: { supported: true, basis: `${SIM}. Simulated tracking numbers start with SIM-.` },
        cancel: { supported: false, basis: "Not simulated." },
        idempotency: { supported: true, basis: SIM },
      },
      services: [
        {
          value: "first_class",
          label: "First-Class (simulated)",
          supported: true,
          supportsReturnReceipt: false,
          tracking: "not_available",
          note: "Simulation only.",
        },
        {
          value: "certified",
          label: "Certified (simulated)",
          supported: true,
          supportsReturnReceipt: true,
          tracking: "available",
          note: "Simulation only.",
        },
      ],
      mayCreateRealMail: false,
      notes: ["No letter is printed or mailed in mock mode.", "Quotes are not simulated."],
    };
  }

  async verifyConnection(): Promise<VerifyResult> {
    return { kind: "ok", message: "Mock provider reachable (simulated — no external connection).", simulated: true };
  }

  async quote(): Promise<QuoteResult> {
    return { kind: "unavailable", message: "The mock provider does not produce prices. No quote is available." };
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const ref = `MOCK-${randomBytes(5).toString("hex").toUpperCase()}`;
    switch (req.simulate ?? "accept") {
      case "reject":
        return {
          kind: "rejected",
          providerStatusRaw: "SIMULATED_REJECTED",
          message: "Simulated rejection (nothing was accepted).",
          httpStatus: null,
        };
      case "timeout":
        return { kind: "unknown", message: "Simulated timeout: the outcome of the submission is unknown." };
      case "accept_awaiting_funding":
        return {
          kind: "accepted",
          providerReference: ref,
          providerStatusRaw: "SIMULATED_ACCEPTED_AWAITING_FUNDING",
          awaitingFunding: true,
          trackingNumber: null,
          costCents: null,
          costCurrency: null,
        };
      default:
        return {
          kind: "accepted",
          providerReference: ref,
          providerStatusRaw: "SIMULATED_ACCEPTED",
          awaitingFunding: false,
          trackingNumber: null,
          costCents: null,
          costCurrency: null,
        };
    }
  }

  async status(): Promise<StatusResult> {
    return {
      kind: "status",
      providerStatusRaw: "SIMULATED_NO_CHANGE",
      events: [],
    };
  }
}
