import { StoreError } from "../store/types";

/** An error whose message is safe to show to the owner (no secrets, no raw payloads). */
export class UserError extends Error {
  constructor(
    message: string,
    public readonly code: string = "invalid",
  ) {
    super(message);
    this.name = "UserError";
  }
}

export function toUserMessage(err: unknown): string {
  if (err instanceof UserError) return err.message;
  if (err instanceof StoreError) {
    switch (err.code) {
      case "unique_violation":
        return "That record already exists.";
      case "foreign_key_violation":
        return "That change would link records that do not belong together (or a record is still in use).";
      case "rule_violation":
      case "check_violation":
        return err.message;
      case "forbidden":
        return "You are not allowed to do that.";
      case "not_found":
        return "Record not found.";
      case "unavailable":
        return err.message;
      default:
        return "The database rejected the request.";
    }
  }
  return "Something went wrong. Nothing was changed unless stated otherwise.";
}

export function assertFound<T>(value: T | null | undefined, what = "Record"): T {
  if (value === null || value === undefined) throw new UserError(`${what} not found.`, "not_found");
  return value;
}
