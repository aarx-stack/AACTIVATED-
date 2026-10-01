import type { AppConfig, MailPolicy } from "../config";
import type { Store } from "../store/types";

export interface OwnerIdentity {
  id: string;
  email: string;
  displayName: string;
}

/** Everything a service needs about the current, already-authorized request. */
export interface Ctx {
  store: Store;
  owner: OwnerIdentity;
  config: AppConfig;
  policy: MailPolicy;
  timezone: string;
  isDemo: boolean;
}
