export interface ToastMsg {
  id: number;
  text: string;
  tone: "ok" | "warn" | "err";
}

type Listener = (toasts: ToastMsg[]) => void;

let toasts: ToastMsg[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn(toasts);
}

export function notify(text: string, tone: ToastMsg["tone"] = "ok") {
  const t = { id: ++seq, text, tone };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, 4200);
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  fn(toasts);
  return () => listeners.delete(fn);
}
