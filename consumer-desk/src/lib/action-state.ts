export interface ActionState {
  status: "idle" | "success" | "error";
  message: string;
}

export const idle: ActionState = { status: "idle", message: "" };
